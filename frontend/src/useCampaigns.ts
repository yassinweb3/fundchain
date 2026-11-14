import { useCallback, useEffect, useRef, useState } from "react";
import { getError } from "./errors";
import { walletServices } from "./web3";
import type { CampaignSnapshot, Session, WalletServices } from "./web3";

type ReadState = { id: number; snapshot: CampaignSnapshot | null; refreshing: boolean; error: string };

export function useCampaigns(session: Session | null, isCurrent: (session: Session) => boolean, services: WalletServices = walletServices) {
  const [state, setState] = useState<ReadState>({ id: -1, snapshot: null, refreshing: false, error: "" });
  const lock = useRef<{ id: number; promise: Promise<boolean> } | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback((): Promise<boolean> => {
    if (!session || !mounted.current || !isCurrent(session)) return Promise.resolve(false);
    if (lock.current?.id === session.id) return lock.current.promise;
    const token = { id: session.id, promise: Promise.resolve(false) };
    lock.current = token;
    setState(previous => ({ id: session.id, snapshot: previous.id === session.id ? previous.snapshot : null, refreshing: true, error: "" }));
    token.promise = (async () => {
      try {
        const snapshot = await services.readCampaigns(session);
        if (!mounted.current || !isCurrent(session)) return false;
        setState({ id: session.id, snapshot, refreshing: false, error: "" });
        return true;
      } catch (error) {
        if (mounted.current && isCurrent(session)) {
          setState(previous => ({ ...previous, refreshing: false, error: getError(error) }));
        }
        return false;
      } finally {
        if (lock.current === token) lock.current = null;
      }
    })();
    return token.promise;
  }, [session, isCurrent, services]);

  const refreshAfterTransaction = useCallback(async () => {
    // A read started before confirmation cannot serve as the post-transaction refresh.
    const existing = lock.current;
    if (existing && session && existing.id === session.id) await existing.promise;
    return refresh();
  }, [session, refresh]);

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!stopped) timer = setTimeout(() => { void poll(); }, 10_000);
    };
    timer = setTimeout(() => { void poll(); }, 0);
    return () => {
      mounted.current = false;
      stopped = true;
      clearTimeout(timer);
    };
  }, [refresh]);

  return {
    snapshot: state.id === session?.id ? state.snapshot : null,
    refreshing: state.id === session?.id && state.refreshing,
    error: state.id === session?.id ? state.error : "",
    refresh,
    refreshAfterTransaction,
  };
}
