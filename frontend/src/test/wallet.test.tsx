import { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useWalletSession } from "../useWalletSession";
import { useCampaigns } from "../useCampaigns";
import { ALICE, BOB, connection, deferred, services, session, WalletStub } from "./fixtures";
import type { CampaignSnapshot, Connection, Session } from "../web3";

describe("wallet sessions", () => {
  it.each(["accountsChanged", "chainChanged", "disconnect"])("invalidates pending connection on %s", async event => {
    const injected = new WalletStub(); window.ethereum = injected;
    const api = services(); const pending = deferred<Connection>();
    vi.mocked(api.connect).mockReturnValue(pending.promise);
    const { result } = renderHook(() => useWalletSession(api));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.connectWallet(); });
    act(() => { injected.emit(event, []); });
    await act(async () => { pending.resolve(connection()); await connecting; });
    expect(result.current.session).toBeNull();
    expect(result.current.connecting).toBe(false);
    expect(result.current.notice).toMatch(/reconnect/i);
  });

  it("ignores an old request even when it finishes after a new connection", async () => {
    const injected = new WalletStub(); window.ethereum = injected;
    const api = services(); const old = deferred<Connection>();
    vi.mocked(api.connect).mockReturnValueOnce(old.promise).mockResolvedValueOnce(connection({ account: BOB }));
    const { result } = renderHook(() => useWalletSession(api));
    let connecting!: Promise<void>;
    act(() => { connecting = result.current.connectWallet(); });
    act(() => { injected.emit("accountsChanged", [BOB]); });
    await act(async () => { await result.current.connectWallet(); });
    await act(async () => { old.resolve(connection()); await connecting; });
    expect(result.current.session?.account).toBe(BOB);
  });

  it("deduplicates connection requests synchronously", async () => {
    window.ethereum = new WalletStub(); const api = services();
    const { result } = renderHook(() => useWalletSession(api));
    await act(async () => { await Promise.all([result.current.connectWallet(), result.current.connectWallet()]); });
    expect(api.connect).toHaveBeenCalledTimes(1);
  });

  it("cleans up captured listeners in Strict Mode and on unmount", async () => {
    const injected = new WalletStub(); window.ethereum = injected;
    const api = services(); const { result, unmount } = renderHook(() => useWalletSession(api), { wrapper: StrictMode });
    expect([...injected.listeners.values()].map(set => set.size)).toEqual([1, 1, 1]);
    await act(async () => { await result.current.connectWallet(); });
    const previous = result.current.session!;
    window.ethereum = new WalletStub();
    unmount();
    expect([...injected.listeners.values()].every(set => set.size === 0)).toBe(true);
    expect(result.current.isCurrent(previous)).toBe(false);
  });

  it("reports missing wallets and rejected requests without a connected session", async () => {
    const api = services(); const { result } = renderHook(() => useWalletSession(api));
    await act(async () => { await result.current.connectWallet(); });
    expect(result.current.error).toMatch(/install/i);
    window.ethereum = new WalletStub();
    vi.mocked(api.connect).mockRejectedValue({ code: 4001 });
    await act(async () => { await result.current.connectWallet(); });
    expect(result.current.error).toMatch(/cancelled/i);
    expect(result.current.session).toBeNull();
  });

  it("resubscribes to a replacement injected provider on reconnect", async () => {
    const old = new WalletStub(); window.ethereum = old;
    const api = services(); const { result } = renderHook(() => useWalletSession(api));
    await act(async () => { await result.current.connectWallet(); });
    const previous = result.current.session!;
    const replacement = new WalletStub(); window.ethereum = replacement;
    expect(result.current.isCurrent(previous)).toBe(false);
    await act(async () => { await result.current.connectWallet(); });
    expect([...old.listeners.values()].every(set => set.size === 0)).toBe(true);
    act(() => replacement.emit("chainChanged", "0x1"));
    expect(result.current.session).toBeNull();
  });
});

describe("campaign reads", () => {
  it("does not read without a connected session", async () => {
    const api = services();
    const { result } = renderHook(() => useCampaigns(null, () => false, api));
    await act(async () => { expect(await result.current.refreshAfterTransaction()).toBe(false); });
    expect(api.readCampaigns).not.toHaveBeenCalled();
  });
  it("never commits old-account data after switching sessions", async () => {
    const api = services(); const old = deferred<CampaignSnapshot>();
    vi.mocked(api.readCampaigns).mockReturnValueOnce(old.promise).mockResolvedValue({ campaigns: [], now: 222 });
    let active = session();
    const isCurrent = (value: Session) => value.id === active.id;
    const { result, rerender } = renderHook(({ current }) => useCampaigns(current, isCurrent, api), { initialProps: { current: active } });
    let first!: Promise<boolean>;
    act(() => { first = result.current.refresh(); });
    active = session(2, BOB); rerender({ current: active });
    await act(async () => { await result.current.refresh(); });
    await act(async () => { old.resolve({ campaigns: [], now: 111 }); await first; });
    expect(result.current.snapshot?.now).toBe(222);
  });

  it("joins concurrent refreshes and keeps snapshot atomic on failure", async () => {
    const api = services(); const pending = deferred<CampaignSnapshot>();
    vi.mocked(api.readCampaigns).mockReturnValue(pending.promise);
    const active = session(); const current = () => true;
    const { result } = renderHook(() => useCampaigns(active, current, api));
    let first!: Promise<boolean>; let second!: Promise<boolean>;
    act(() => { first = result.current.refresh(); second = result.current.refresh(); });
    expect(first).toBe(second);
    expect(api.readCampaigns).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve({ campaigns: [], now: 123 }); await first; });
    vi.mocked(api.readCampaigns).mockRejectedValue(new Error("RPC unavailable"));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.snapshot?.now).toBe(123);
    expect(result.current.error).toBe("RPC unavailable");
  });

  it("does not overlap slow polling requests or poll after unmount", async () => {
    vi.useFakeTimers();
    const api = services(); const pending = deferred<CampaignSnapshot>();
    vi.mocked(api.readCampaigns).mockReturnValue(pending.promise);
    const active = session(); const { unmount } = renderHook(() => useCampaigns(active, () => true, api));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.readCampaigns).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { pending.resolve({ campaigns: [], now: 123 }); await vi.advanceTimersByTimeAsync(30_000); });
    expect(api.readCampaigns).toHaveBeenCalledTimes(1);
  });

  it("loads after connecting with the authenticated account", async () => {
    const api = services(); const active = session();
    const { result } = renderHook(() => useCampaigns(active, () => true, api));
    await waitFor(() => expect(result.current.snapshot?.now).toBe(1000));
    expect(vi.mocked(api.readCampaigns).mock.calls[0][0].account).toBe(ALICE);
  });

  it("starts a fresh read after confirmation instead of joining a pre-confirmation read", async () => {
    vi.useFakeTimers();
    const api = services(); const old = deferred<CampaignSnapshot>();
    vi.mocked(api.readCampaigns).mockReturnValueOnce(old.promise).mockResolvedValue({ campaigns: [], now: 222 });
    const active = session(); const current = () => true;
    const { result } = renderHook(() => useCampaigns(active, current, api));
    let before!: Promise<boolean>; let after!: Promise<boolean>;
    act(() => { before = result.current.refresh(); after = result.current.refreshAfterTransaction(); });
    expect(api.readCampaigns).toHaveBeenCalledTimes(1);
    await act(async () => { old.resolve({ campaigns: [], now: 111 }); await before; await after; });
    expect(api.readCampaigns).toHaveBeenCalledTimes(2);
    expect(result.current.snapshot?.now).toBe(222);
  });
});
