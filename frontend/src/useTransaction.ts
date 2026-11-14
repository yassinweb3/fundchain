import { useCallback, useEffect, useRef, useState } from "react";
import { errorCode, getError } from "./errors";
import { sameIntent, walletServices } from "./web3";
import type { Identity, Intent, Receipt, Session, Submitted, WalletServices } from "./web3";
import type { WalletSession } from "./useWalletSession";

export type TransactionState = {
  status: "awaiting-signature" | "pending" | "confirmed" | "rejected" | "failed" | "cancelled" | "tracking-unavailable";
  account: string;
  chainId: bigint;
  label: string;
  hash?: string;
  error?: string;
  refreshWarning?: string;
  manualReview?: boolean;
};
type Pending = { session: Session; expected: Identity; hash: string; label: string; verified: boolean };

export function useTransaction(wallet: Pick<WalletSession, "getSession" | "isCurrent">, refresh: () => Promise<boolean>, services: WalletServices = walletServices) {
  const [transaction, setTransaction] = useState<TransactionState | null>(null);
  const [working, setWorking] = useState(false);
  const locked = useRef(false);
  const pending = useRef<Pending | null>(null);
  const tracking = useRef(false);
  const mounted = useRef(true);
  const { getSession, isCurrent } = wallet;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const publish = useCallback((state: TransactionState) => {
    if (mounted.current) setTransaction(state);
  }, []);

  const finish = useCallback(async (item: Pending, receipt: Receipt | null, refreshSession: Session): Promise<boolean> => {
    const context = { account: item.session.account, chainId: item.session.chainId, label: item.label, hash: item.hash };
    if (!item.verified) {
      publish({ ...context, status: "tracking-unavailable", manualReview: true, error: "The wallet returned a different transaction. Verify its details in your wallet." });
      return false;
    }
    if (!receipt || (receipt.status !== 0 && receipt.status !== 1) || receipt.hash.toLowerCase() !== item.hash.toLowerCase()) {
      publish({ ...context, status: "tracking-unavailable", error: "Confirmation is unknown. Check this transaction before submitting another request." });
      return false;
    }
    pending.current = null;
    if (receipt.status !== 1) {
      publish({ ...context, status: "failed", error: "The transaction reverted on-chain." });
      return false;
    }
    publish({ ...context, status: "confirmed" });
    if (mounted.current && isCurrent(refreshSession)) {
      let refreshed = false;
      try { refreshed = await refresh(); } catch { /* Confirmation is independent of data refresh. */ }
      if (!refreshed && isCurrent(refreshSession)) {
        publish({ ...context, status: "confirmed", refreshWarning: "Transaction confirmed, but campaign refresh failed. Refresh to update the displayed data." });
      }
    }
    return mounted.current && isCurrent(item.session);
  }, [publish, refresh, isCurrent]);

  const execute = useCallback(async (intent: Intent): Promise<boolean> => {
    const session = getSession();
    if (!session || locked.current || !mounted.current) return false;
    locked.current = true;
    setWorking(true);
    const context = { account: session.account, chainId: session.chainId, label: intent.label };
    publish({ ...context, status: "awaiting-signature" });
    let sending = false;
    let submitted: Submitted | null = null;
    let uncertain = false;
    try {
      const prepared = await services.prepare(session, intent);
      if (!mounted.current || !isCurrent(session)) throw new Error("Wallet changed before submission. Reconnect and review the request.");
      sending = true;
      submitted = await prepared.send();
      const item = { session, expected: prepared.expected, hash: submitted.hash, label: intent.label, verified: sameIntent(submitted, prepared.expected) };
      pending.current = item;
      if (!sameIntent(submitted, prepared.expected)) {
        publish({ ...context, hash: submitted.hash, status: "tracking-unavailable", manualReview: true, error: "The wallet returned a different transaction. Verify its details in your wallet." });
        return false;
      }
      publish({ ...context, hash: submitted.hash, status: "pending" });
      try {
        return await finish(item, await submitted.wait(1, 60_000), session);
      } catch (error) {
        if (errorCode(error, "TRANSACTION_REPLACED")) {
          const replacementError = error as { replacement?: Submitted; receipt?: Receipt; cancelled?: boolean };
          const replacement = replacementError.replacement;
          if (replacement && replacementError.receipt &&
              replacementError.receipt.hash.toLowerCase() === replacement.hash.toLowerCase() &&
              (replacementError.receipt.status === 0 || replacementError.receipt.status === 1)) {
            item.hash = replacement.hash;
            if (replacementError.cancelled || !sameIntent(replacement, prepared.expected)) {
              pending.current = null;
              publish({ ...context, hash: replacement.hash, status: "cancelled", error: "The original transaction was cancelled or replaced with a different action." });
              return false;
            }
            return await finish(item, replacementError.receipt, session);
          }
        }
        const failed = error as { receipt?: Receipt };
        if (failed?.receipt?.status === 0) return await finish(item, failed.receipt, session);
        publish({ ...context, hash: item.hash, status: "tracking-unavailable", error: "Confirmation tracking is unavailable. The transaction may still complete. Check its status before retrying." });
        return false;
      }
    } catch (error) {
      const rejected = errorCode(error, 4001) || errorCode(error, "ACTION_REJECTED");
      const definitive = rejected || errorCode(error, "INSUFFICIENT_FUNDS") || errorCode(error, "CALL_EXCEPTION") || errorCode(error, "INVALID_ARGUMENT");
      if (sending && !submitted && !definitive) {
        // A lost response does not prove that the wallet failed to broadcast the request.
        uncertain = true;
        publish({ ...context, status: "tracking-unavailable", manualReview: true, error: "The wallet response was lost. Check wallet history before starting another transaction." });
      } else {
        publish({ ...context, status: rejected ? "rejected" : "failed", error: getError(error) });
      }
      return false;
    } finally {
      if (mounted.current) setWorking(false);
      // Keep uncertain submissions locked until tracking or explicit wallet reconciliation.
      locked.current = pending.current !== null || uncertain;
    }
  }, [getSession, isCurrent, services, publish, finish]);

  const retryTracking = useCallback(async () => {
    const item = pending.current;
    const session = getSession();
    if (!item || !session || working || tracking.current) return;
    if (session.account !== item.session.account || session.chainId !== item.session.chainId) {
      publish({ account: item.session.account, chainId: item.session.chainId, label: item.label, hash: item.hash,
        status: "tracking-unavailable", error: "Reconnect the originating account and network to check this transaction." });
      return;
    }
    tracking.current = true;
    setWorking(true);
    try { await finish(item, await services.track(session, item.hash), session); }
    catch {
      publish({ account: item.session.account, chainId: item.session.chainId, label: item.label, hash: item.hash,
        status: "tracking-unavailable", error: "Confirmation tracking is still unavailable. Check your wallet and network." });
    } finally {
      tracking.current = false;
      locked.current = pending.current !== null;
      if (mounted.current) setWorking(false);
    }
  }, [getSession, services, finish, publish, working]);

  const acknowledgeUnsent = useCallback(() => {
    if (pending.current?.verified || working || tracking.current) return;
    pending.current = null;
    locked.current = false;
    setTransaction(null);
  }, [working]);

  return { transaction, execute, retryTracking, acknowledgeUnsent, working,
    busy: working || transaction?.status === "tracking-unavailable" };
}
