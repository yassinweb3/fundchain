import { describe, expect, it, vi } from "vitest";
import { contractErrors, getError } from "../errors";
import { contractInterface, payoutRecipient, CONTRACT_ADDRESS } from "../contract";
import { ErrorFragment, ZeroAddress } from "ethers";
import { BOB } from "./fixtures";

describe("contract and wallet errors", () => {
  it.each(Object.entries(contractErrors))("decodes %s through nested provider errors", (name, message) => {
    expect(getError({ code: "CALL_EXCEPTION", info: { error: { data: { originalError: { data: contractInterface.encodeErrorResult(name, []) } } } } })).toBe(message);
  });
  it("keeps the ABI error list and user messages synchronized", () => {
    const names = contractInterface.fragments.filter(ErrorFragment.isFragment).map(fragment => fragment.name).sort();
    expect(names).toEqual(Object.keys(contractErrors).sort());
    expect(contractInterface.getFunction("withdrawTo")).not.toBeNull();
    expect(contractInterface.getFunction("refundTo")).not.toBeNull();
  });
  it("handles rejection, insufficient funds and an already-open request", () => {
    expect(getError({ info: { error: { code: 4001 } } })).toMatch(/cancelled/i);
    expect(getError({ code: "INSUFFICIENT_FUNDS" })).toMatch(/insufficient ETH/i);
    expect(getError({ code: -32002 })).toMatch(/already open/i);
  });
  it("uses readable fallbacks for unknown, malformed and circular errors", () => {
    expect(getError({ code: "CALL_EXCEPTION", data: "0xdeadbeef" })).toMatch(/contract rejected/i);
    expect(getError(new Error("RPC unavailable"))).toBe("RPC unavailable");
    const cyclic: Record<string, unknown> = {}; cyclic.error = cyclic;
    expect(getError(cyclic)).toMatch(/could not be completed/i);
    expect(getError(null)).toMatch(/could not be completed/i);
  });
});

describe("recovery recipient validation", () => {
  it("keeps ordinary claims and accepts a valid explicit recipient", () => {
    expect(payoutRecipient("  ")).toBeUndefined();
    expect(payoutRecipient(BOB)).toBe(BOB);
  });
  it.each([ZeroAddress, CONTRACT_ADDRESS, "not an address", "0x1234"])("rejects %s", value => {
    expect(() => payoutRecipient(value)).toThrow();
  });
});

describe("deployment configuration", () => {
  it.each([
    ["VITE_CHAIN_ID", "0"], ["VITE_CHAIN_ID", "0x7a69"],
    ["VITE_CONTRACT_ADDRESS", ZeroAddress], ["VITE_CONTRACT_ADDRESS", "bad"],
  ])("rejects invalid %s=%s", async (name, value) => {
    vi.resetModules(); vi.stubEnv(name, value);
    const configured = await import("../contract");
    expect(() => configured.deployment()).toThrow();
  });
});
