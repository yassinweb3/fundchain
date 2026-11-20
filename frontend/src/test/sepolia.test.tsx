import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALICE, WalletStub } from "./fixtures";

const ADDRESS = "0xC0ea3c8c97334955f02D357604346b32F8A4151E";
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("VITE_CHAIN_ID", "11155111");
  vi.stubEnv("VITE_NETWORK_NAME", "Ethereum Sepolia");
  vi.stubEnv("VITE_CONTRACT_ADDRESS", ADDRESS);
});
it("loads the exact Sepolia configuration and both payout recovery methods", async () => {
  const { deployment, NETWORK_NAME, contractInterface } = await import("../contract");
  expect(deployment()).toMatchObject({ chainId: 11155111n, address: ADDRESS });
  expect(NETWORK_NAME).toBe("Ethereum Sepolia");
  for (const method of ["withdrawTo", "refundTo"]) expect(contractInterface.getFunction(method)).toBeTruthy();
});
it("requires Sepolia, reconnects after a user network switch, and invalidates the old session without sending", async () => {
  const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "../out/Crowdfunding.sol/Crowdfunding.json"), "utf8"));
  const injected = new WalletStub();
  let chain = "0x7a69";
  injected.request.mockImplementation(async ({ method }) => {
    if (method === "eth_chainId") return chain;
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [ALICE];
    if (method === "eth_getCode") return artifact.deployedBytecode.object;
    throw new Error("Unexpected RPC method: " + method);
  });
  window.ethereum = injected;
  const { useWalletSession } = await import("../useWalletSession");
  const { result, unmount } = renderHook(() => useWalletSession());
  await act(async () => { await result.current.connectWallet(); });
  expect(result.current.session).toBeNull();
  expect(result.current.error).toMatch(/Switch your wallet to Ethereum Sepolia/);
  chain = "0xaa36a7";
  act(() => injected.emit("chainChanged", chain));
  await act(async () => { await result.current.connectWallet(); });
  expect(result.current.session?.chainId).toBe(11155111n);
  expect(result.current.session?.config.address).toBe(ADDRESS);
  const previous = result.current.session!;
  chain = "0x1";
  act(() => injected.emit("chainChanged", chain));
  expect(result.current.session).toBeNull();
  expect(result.current.isCurrent(previous)).toBe(false);
  expect(result.current.notice).toMatch(/reconnect/i);
  expect(injected.request.mock.calls.every(([request]) =>
    !/^(eth_send|eth_sign|personal_sign|wallet_send)/.test(request.method))).toBe(true);
  previous.provider.destroy();
  unmount();
});
