import { act, renderHook, waitFor } from "@testing-library/react";
import { BrowserProvider } from "ethers";
import type { Block } from "ethers";
import { expect, it, vi } from "vitest";
import { contractInterface } from "../contract";
import { readCampaigns } from "../web3";
import type { CampaignSnapshot } from "../web3";
import { useCampaigns } from "../useCampaigns";
import { ALICE, WalletStub, deferred, services, session } from "./fixtures";

it.each([0, 5, 12, 13, 1000])("bounds contract reads at count %s and pins every call to one block", async total => {
 const raw = new WalletStub();
 let calls = 0;
 raw.request.mockImplementation(async ({ method, params }) => {
   if (method === "eth_chainId") return "0x7a69";
   if (method === "eth_accounts") return [ALICE];
   if (method === "eth_call") {
     calls++;
     const [call, block] = params as [{ data: string }, string];
     expect(block).toBe("0x7");
     const decoded = contractInterface.parseTransaction(call)!;
     if (decoded.name === "campaignCount") return contractInterface.encodeFunctionResult(decoded.name, [total]);
     if (decoded.name === "campaigns") return contractInterface.encodeFunctionResult(decoded.name, [ALICE, 10n, 2n, 100n, false]);
     return contractInterface.encodeFunctionResult("contributions", [2n]);
   }
   throw Error(method);
 });
 const provider = new BrowserProvider(raw, undefined, { cacheTimeout: -1 });
 vi.spyOn(provider, "getBlock").mockResolvedValue({ number: 7, timestamp: 101 } as Block);
 try {
   const result = await readCampaigns({ ...session(), injected: raw, provider });
   expect(result.campaigns.map(c => c.id)).toEqual(Array.from({length: Math.min(total, 12)}, (_, i) => total - i));
   expect(calls).toBe(1 + 2 * Math.min(total, 12));
   expect(calls).toBeLessThanOrEqual(25);
   const older = await readCampaigns({ ...session(), injected: raw, provider }, Math.max(0, total - 12));
   expect(older.start).toBe(Math.max(0, total - 12));
 } finally { provider.destroy(); }
});

function page(start: number, total = 30): CampaignSnapshot { return { total, start, campaigns: [], now: start }; }
it("anchors refreshes, rejects stale navigation reads, and explicitly discovers newest campaigns", async () => {
 const api = services(), active = session(), valid = () => true;
 vi.mocked(api.readCampaigns).mockResolvedValue(page(30));
 const { result } = renderHook(() => useCampaigns(active, valid, api));
 await waitFor(() => expect(result.current.snapshot?.start).toBe(30));
 vi.mocked(api.readCampaigns).mockResolvedValue(page(30, 31));
 await act(async () => { await result.current.refresh(); });
 expect(vi.mocked(api.readCampaigns).mock.calls.at(-1)?.[1]).toBe(30);
 const old = deferred<CampaignSnapshot>();
 vi.mocked(api.readCampaigns).mockReturnValueOnce(old.promise).mockResolvedValueOnce(page(31));
 act(() => result.current.older());
 expect(result.current.snapshot).toBeNull();
 act(() => result.current.newest());
 await waitFor(() => expect(result.current.snapshot?.start).toBe(31));
 await act(async () => { old.resolve(page(18)); await old.promise; });
 expect(result.current.snapshot?.start).toBe(31);
 expect(vi.mocked(api.readCampaigns).mock.calls.at(-1)?.[1]).toBeNull();
});
it("pauses hidden polling, resumes once, and cleans up the visibility listener", async () => {
 vi.useFakeTimers();
 let hidden = false;
 vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
 const api = services(), active = session(), valid = () => true;
 const { unmount } = renderHook(() => useCampaigns(active, valid, api));
 await act(async () => { await vi.advanceTimersByTimeAsync(1); });
 const before = vi.mocked(api.readCampaigns).mock.calls.length;
 hidden = true; document.dispatchEvent(new Event("visibilitychange"));
 await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
 expect(api.readCampaigns).toHaveBeenCalledTimes(before);
 hidden = false; document.dispatchEvent(new Event("visibilitychange"));
 await act(async () => { await vi.advanceTimersByTimeAsync(1); });
 expect(api.readCampaigns).toHaveBeenCalledTimes(before + 1);
 unmount(); document.dispatchEvent(new Event("visibilitychange"));
 await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
 expect(api.readCampaigns).toHaveBeenCalledTimes(before + 1);
});

it("does not create duplicate poll loops when visibility changes during a pending read", async () => {
 vi.useFakeTimers();
 const api = services(), active = session(), valid = () => true;
 const pending = deferred<CampaignSnapshot>();
 vi.mocked(api.readCampaigns).mockReturnValueOnce(pending.promise).mockResolvedValue(page(30));
 let hidden = false;
 vi.spyOn(document, "visibilityState", "get").mockImplementation(() => hidden ? "hidden" : "visible");
 const { unmount } = renderHook(() => useCampaigns(active, valid, api));
 await act(async () => { await vi.advanceTimersByTimeAsync(1); });
 hidden = true; document.dispatchEvent(new Event("visibilitychange"));
 hidden = false; document.dispatchEvent(new Event("visibilitychange"));
 await act(async () => { await vi.advanceTimersByTimeAsync(1); });
 await act(async () => { pending.resolve(page(30)); await pending.promise; });
 expect(vi.getTimerCount()).toBe(1);
 await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
 expect(api.readCampaigns).toHaveBeenCalledTimes(2);
 unmount();
});
it("refreshes the current page after confirmation despite navigating during an older read", async () => {
 const api = services(), active = session(), valid = () => true;
 vi.mocked(api.readCampaigns).mockResolvedValue(page(30));
 const { result } = renderHook(() => useCampaigns(active, valid, api));
 await waitFor(() => expect(result.current.snapshot?.start).toBe(30));
 const pending = deferred<CampaignSnapshot>();
 vi.mocked(api.readCampaigns).mockReturnValueOnce(pending.promise).mockResolvedValue(page(18));
 let refreshing!: Promise<boolean>, confirmed!: Promise<boolean>;
 act(() => { refreshing = result.current.refresh(); confirmed = result.current.refreshAfterTransaction(); result.current.older(); });
 await waitFor(() => expect(result.current.snapshot?.start).toBe(18));
 await act(async () => { pending.resolve(page(30)); await refreshing; await confirmed; });
 expect(result.current.snapshot?.start).toBe(18);
 expect(vi.mocked(api.readCampaigns).mock.calls.at(-1)?.[1]).toBe(18);
});

it("deduplicates repeated navigation intent and keeps page failures separate from empty data", async () => {
 const api = services(), active = session(), valid = () => true;
 vi.mocked(api.readCampaigns).mockResolvedValue(page(30));
 const { result } = renderHook(() => useCampaigns(active, valid, api));
 await waitFor(() => expect(result.current.snapshot?.start).toBe(30));
 const pending = deferred<CampaignSnapshot>();
 vi.mocked(api.readCampaigns).mockReturnValueOnce(pending.promise);
 act(() => { result.current.older(); result.current.older(); });
 expect(api.readCampaigns).toHaveBeenCalledTimes(2);
 await act(async () => { pending.reject(Error("Page unavailable")); });
 expect(result.current.snapshot).toBeNull();
 expect(result.current.error).toBe("Page unavailable");
 vi.mocked(api.readCampaigns).mockResolvedValue(page(18));
 await act(async () => { await result.current.refresh(); });
 expect(vi.mocked(api.readCampaigns).mock.calls.at(-1)?.[1]).toBe(18);
 expect(result.current.snapshot?.start).toBe(18);
});

it("resets the page boundary on account/session changes", async () => {
 const api = services(); let active = session();
 const valid = (value: ReturnType<typeof session>) => value.id === active.id;
 vi.mocked(api.readCampaigns).mockResolvedValue(page(30));
 const { result, rerender } = renderHook(({ current }) => useCampaigns(current, valid, api), { initialProps: { current: active } });
 await waitFor(() => expect(result.current.snapshot?.start).toBe(30));
 vi.mocked(api.readCampaigns).mockResolvedValue(page(18));
 act(() => result.current.older());
 await waitFor(() => expect(result.current.snapshot?.start).toBe(18));
 active = session(2);
 rerender({ current: active });
 await act(async () => { await result.current.refresh(); });
 expect(vi.mocked(api.readCampaigns).mock.calls.at(-1)?.[1]).toBeNull();
});
