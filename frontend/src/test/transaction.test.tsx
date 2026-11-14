import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTransaction } from "../useTransaction";
import type { Intent, Prepared, Receipt, Session } from "../web3";
import { ALICE, BOB, HASH, REPLACEMENT_HASH, deferred, identity, services, session, submitted } from "./fixtures";

const intent: Intent = { method: "withdraw", args: [1], label: "Withdraw campaign #1" };
function setup() {
  const api = services();
  let current: Session | null = session();
  const wallet = { getSession: () => current, isCurrent: (candidate: Session) => current?.id === candidate.id };
  const refresh = vi.fn(async () => true);
  const hook = renderHook(() => useTransaction(wallet, refresh, api));
  return { ...hook, api, refresh, switchSession: (next: Session | null) => { current = next; } };
}

describe("transaction lifecycle", () => {
  it("deduplicates clicks synchronously and preserves pending hash/context", async () => {
    const { result, api } = setup(); const receipt = deferred<Receipt | null>();
    const send = vi.fn(async () => submitted({ wait: () => receipt.promise }));
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send });
    let completion!: Promise<boolean>; let duplicate!: Promise<boolean>;
    act(() => { completion = result.current.execute(intent); duplicate = result.current.execute(intent); });
    await waitFor(() => expect(result.current.transaction?.status).toBe("pending"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(await duplicate).toBe(false);
    expect(result.current.transaction).toMatchObject({ hash: HASH, account: ALICE, chainId: 31337n });
    await act(async () => { receipt.resolve({ hash: HASH, status: 1 }); expect(await completion).toBe(true); });
    expect(result.current.transaction?.status).toBe("confirmed");
  });

  it.each([false, "throw"])("keeps confirmation when refresh fails (%s)", async failure => {
    const { result, refresh } = setup();
    if (failure === false) refresh.mockResolvedValue(false);
    else refresh.mockRejectedValue(new Error("RPC down"));
    await act(async () => { expect(await result.current.execute(intent)).toBe(true); });
    expect(result.current.transaction).toMatchObject({ status: "confirmed", hash: HASH });
    expect(result.current.transaction?.refreshWarning).toMatch(/refresh failed/i);
  });

  it("does not send after switching during preparation", async () => {
    const { result, api, switchSession } = setup(); const preparation = deferred<Prepared>();
    vi.mocked(api.prepare).mockReturnValue(preparation.promise);
    const send = vi.fn(async () => submitted()); let completion!: Promise<boolean>;
    act(() => { completion = result.current.execute(intent); });
    switchSession(session(2, BOB));
    await act(async () => { preparation.resolve({ expected: identity, send }); expect(await completion).toBe(false); });
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps an old account's confirmed transaction without refreshing or clearing the new account's drafts", async () => {
    const { result, api, switchSession, refresh } = setup(); const receipt = deferred<Receipt | null>();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: () => receipt.promise }) });
    let completion!: Promise<boolean>;
    act(() => { completion = result.current.execute(intent); });
    await waitFor(() => expect(result.current.transaction?.hash).toBe(HASH));
    switchSession(session(2, BOB));
    await act(async () => { receipt.resolve({ hash: HASH, status: 1 }); expect(await completion).toBe(false); });
    expect(result.current.transaction).toMatchObject({ status: "confirmed", account: ALICE, hash: HASH });
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([{ code: 4001 }, { code: "ACTION_REJECTED" }, { code: "INSUFFICIENT_FUNDS" }])("unlocks after a definitive pre-broadcast error %j", async error => {
    const { result, api } = setup(); const send = vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(submitted());
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send });
    await act(async () => { expect(await result.current.execute(intent)).toBe(false); });
    expect(result.current.busy).toBe(false);
    await act(async () => { expect(await result.current.execute(intent)).toBe(true); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reports mined failure with its hash", async () => {
    const { result, api } = setup();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: async () => ({ hash: HASH, status: 0 }) }) });
    await act(async () => { expect(await result.current.execute(intent)).toBe(false); });
    expect(result.current.transaction).toMatchObject({ status: "failed", hash: HASH });
    expect(result.current.busy).toBe(false);
  });

  it("retains uncertain transactions, blocks rebroadcast, and allows tracking retry", async () => {
    const { result, api } = setup();
    const send = vi.fn(async () => submitted({ wait: async () => { throw new Error("RPC unavailable"); } }));
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send });
    await act(async () => { await result.current.execute(intent); });
    expect(result.current.transaction).toMatchObject({ status: "tracking-unavailable", hash: HASH });
    await act(async () => { expect(await result.current.execute(intent)).toBe(false); });
    expect(send).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.retryTracking(); });
    expect(result.current.transaction?.status).toBe("confirmed");
    expect(result.current.busy).toBe(false);
  });

  it("requires manual reconciliation after losing the wallet response before receiving a hash", async () => {
    const { result, api } = setup();
    const send = vi.fn().mockRejectedValueOnce(new Error("transport lost")).mockResolvedValueOnce(submitted());
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send });
    await act(async () => { await result.current.execute(intent); });
    expect(result.current.transaction).toMatchObject({ status: "tracking-unavailable", manualReview: true });
    await act(async () => { expect(await result.current.execute(intent)).toBe(false); });
    act(() => result.current.acknowledgeUnsent());
    await act(async () => { expect(await result.current.execute(intent)).toBe(true); });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("will not attribute a mismatched transaction to the intended action", async () => {
    const { result, api } = setup();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ from: BOB }) });
    await act(async () => { await result.current.execute(intent); });
    await act(async () => { await result.current.retryTracking(); });
    expect(result.current.transaction).toMatchObject({ status: "tracking-unavailable", manualReview: true });
  });

  it.each(["repriced", "cancelled", "different"])("handles replacement: %s", async kind => {
    const { result, api } = setup();
    const replacement = submitted({ hash: REPLACEMENT_HASH, data: kind === "different" ? "0x" : identity.data });
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: async () => {
      throw { code: "TRANSACTION_REPLACED", cancelled: kind === "cancelled", replacement, receipt: { hash: REPLACEMENT_HASH, status: 1 } };
    } }) });
    await act(async () => { await result.current.execute(intent); });
    expect(result.current.transaction).toMatchObject({ status: kind === "repriced" ? "confirmed" : "cancelled", hash: REPLACEMENT_HASH });
    expect(result.current.busy).toBe(false);
  });

  it("does not send when unmounted during preparation", async () => {
    const { result, api, unmount } = setup(); const preparation = deferred<Prepared>();
    vi.mocked(api.prepare).mockReturnValue(preparation.promise);
    const send = vi.fn(async () => submitted()); let completion!: Promise<boolean>;
    act(() => { completion = result.current.execute(intent); }); unmount();
    await act(async () => { preparation.resolve({ expected: identity, send }); await completion; });
    expect(send).not.toHaveBeenCalled();
  });

  it.each([null, { hash: HASH, status: null }, { hash: REPLACEMENT_HASH, status: 1 }])("keeps an unverified receipt uncertain: %j", async receipt => {
    const { result, api } = setup();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: async () => receipt }) });
    await act(async () => { await result.current.execute(intent); });
    expect(result.current.transaction?.status).toBe("tracking-unavailable");
    expect(result.current.busy).toBe(true);
  });

  it("joins duplicate tracking clicks without allowing a stale receipt to race a new transaction", async () => {
    const { result, api } = setup();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: async () => null }) });
    await act(async () => { await result.current.execute(intent); });
    const receipt = deferred<Receipt | null>(); vi.mocked(api.track).mockReturnValue(receipt.promise);
    let first!: Promise<void>; let second!: Promise<void>;
    act(() => { first = result.current.retryTracking(); second = result.current.retryTracking(); });
    expect(api.track).toHaveBeenCalledTimes(1);
    await act(async () => { receipt.resolve({ hash: HASH, status: 1 }); await first; await second; });
    expect(result.current.transaction?.status).toBe("confirmed");
  });

  it("requires the originating account/network for tracking and permits a new session of that account", async () => {
    const { result, api, switchSession } = setup();
    vi.mocked(api.prepare).mockResolvedValue({ expected: identity, send: async () => submitted({ wait: async () => null }) });
    await act(async () => { await result.current.execute(intent); });
    switchSession(session(2, BOB));
    await act(async () => { await result.current.retryTracking(); });
    expect(api.track).not.toHaveBeenCalled();
    switchSession(session(3, ALICE));
    await act(async () => { await result.current.retryTracking(); });
    expect(result.current.transaction?.status).toBe("confirmed");
  });
});
