import { BrowserProvider, Network, keccak256 } from "ethers";
import type { Block } from "ethers";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { contractInterface, deployment } from "../contract";
import { connect, prepare, readCampaigns, sameIntent, verifyDeployment } from "../web3";
import { ALICE, BOB, WalletStub, identity, session } from "./fixtures";

describe("deployment verification", () => {
  const code = "0x60006000";
  const config = { ...deployment(), runtimeHash: keccak256(code) };
  function provider(chain = 31337, bytecode = code) {
    return { getNetwork: vi.fn(async () => Network.from(chain)), getCode: vi.fn(async () => bytecode) };
  }
  it("accepts the expected chain and exact runtime", async () => {
    await expect(verifyDeployment(provider(), config)).resolves.toBeUndefined();
  });
  it("rejects the wrong chain before reading code", async () => {
    const rpc = provider(1);
    await expect(verifyDeployment(rpc, config)).rejects.toThrow(/Switch your wallet/);
    expect(rpc.getCode).not.toHaveBeenCalled();
  });
  it.each(["0x", "0x6001"])("rejects missing, stale or unrelated runtime %s", async bytecode => {
    await expect(verifyDeployment(provider(31337, bytecode), config)).rejects.toThrow(/contract|deployment/i);
  });
  it("propagates a code lookup failure and never marks it verified", async () => {
    const rpc = provider(); rpc.getCode.mockRejectedValue(new Error("RPC down"));
    await expect(verifyDeployment(rpc, config)).rejects.toThrow("RPC down");
  });
});

function injectedWallet() {
  const raw = new WalletStub();
  raw.request.mockImplementation(async ({ method }) => {
    if (method === "eth_chainId") return "0x7a69";
    if (method === "eth_accounts" || method === "eth_requestAccounts") return [ALICE];
    throw new Error(`Unexpected RPC method: ${method}`);
  });
  return raw;
}

describe("wallet RPC services", () => {
  it("rejects a wrong-network connection", async () => {
    const raw = injectedWallet();
    raw.request.mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x1" : [ALICE]);
    await expect(connect(raw)).rejects.toThrow(/Switch your wallet/);
  });

  it("rejects an empty account list", async () => {
    const raw = injectedWallet(); raw.request.mockResolvedValue([]);
    await expect(connect(raw)).rejects.toThrow(/No wallet account/);
  });

  it("verifies a real generated runtime and binds writes to the selected account/chain", async () => {
    const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "../out/Crowdfunding.sol/Crowdfunding.json"), "utf8"));
    const raw = injectedWallet();
    raw.request.mockImplementation(async ({ method }) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [ALICE];
      if (method === "eth_getCode") return artifact.deployedBytecode.object;
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const connected = await connect(raw);
    const prepared = await prepare({ ...connected, id: 1 }, { method: "refundTo", args: [1, BOB], label: "Refund" });
    expect(prepared.expected).toMatchObject({ from: ALICE, to: deployment().address, chainId: 31337n, value: 0n });
    expect(contractInterface.parseTransaction({ data: prepared.expected.data })?.name).toBe("refundTo");
    expect(raw.request.mock.calls.some(([request]) => request.method === "eth_sendTransaction")).toBe(false);
  });

  it("rejects account switching before preparing a write", async () => {
    const raw = injectedWallet();
    raw.request.mockImplementation(async ({ method }) => method === "eth_chainId" ? "0x7a69" : [BOB]);
    await expect(prepare({ ...session(), injected: raw }, { method: "withdraw", args: [1], label: "Withdraw" })).rejects.toThrow(/changed/i);
  });

  it("reads count, campaigns, contributions and timestamp from one block", async () => {
    const raw = injectedWallet();
    raw.request.mockImplementation(async ({ method, params }) => {
      if (method === "eth_chainId") return "0x7a69";
      if (method === "eth_accounts") return [ALICE];
      if (method === "eth_call") {
        const [call, blockTag] = params as [{ data: string }, string];
        expect(blockTag).toBe("0x7");
        const decoded = contractInterface.parseTransaction(call)!;
        if (decoded.name === "campaignCount") return contractInterface.encodeFunctionResult(decoded.name, [1]);
        if (decoded.name === "campaigns") return contractInterface.encodeFunctionResult(decoded.name, [ALICE, 10n, 2n, 100n, false]);
        if (decoded.name === "contributions") {
          expect(decoded.args[1]).toBe(ALICE);
          return contractInterface.encodeFunctionResult(decoded.name, [2n]);
        }
      }
      throw new Error(`Unexpected RPC method: ${method}`);
    });
    const provider = new BrowserProvider(raw);
    vi.spyOn(provider, "getBlock").mockResolvedValue({ number: 7, timestamp: 101 } as Block);
    const result = await readCampaigns({ ...session(), injected: raw, provider });
    expect(result.now).toBe(101000);
    expect(result.campaigns[0]).toMatchObject({ id: 1, contribution: 2n, raised: 2n, deadline: 100 });
    provider.destroy();
  });

  it("checks the identity of replacements instead of trusting their success receipt", () => {
    expect(sameIntent(identity, identity)).toBe(true);
    expect(sameIntent({ ...identity, from: BOB }, identity)).toBe(false);
    expect(sameIntent({ ...identity, chainId: 1n }, identity)).toBe(false);
    expect(sameIntent({ ...identity, data: "0x" }, identity)).toBe(false);
    expect(sameIntent({ ...identity, value: 1n }, identity)).toBe(false);
  });
});
