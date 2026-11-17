import { vi } from "vitest";
import type { BrowserProvider } from "ethers";
import { contractInterface, deployment } from "../contract";
import type { Connection, Identity, InjectedWallet, Session, Submitted, WalletServices } from "../web3";

export const ALICE = "0x1111111111111111111111111111111111111111";
export const BOB = "0x2222222222222222222222222222222222222222";
export const HASH = "0x" + "ab".repeat(32);
export const REPLACEMENT_HASH = "0x" + "cd".repeat(32);

export class WalletStub implements InjectedWallet {
  listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  request = vi.fn<InjectedWallet["request"]>();
  on(event: string, listener: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)?.add(listener);
  }
  removeListener(event: string, listener: (...args: unknown[]) => void) { this.listeners.get(event)?.delete(listener); }
  emit(event: string, ...args: unknown[]) { this.listeners.get(event)?.forEach(listener => listener(...args)); }
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function connection(overrides: Partial<Connection> = {}): Connection {
  return { account: ALICE, chainId: 31337n, injected: new WalletStub(), provider: {} as BrowserProvider, config: deployment(), ...overrides };
}
export function session(id = 1, account = ALICE): Session { return { ...connection({ account }), id }; }
export const identity: Identity = { from: ALICE, to: deployment().address, chainId: 31337n, data: contractInterface.encodeFunctionData("withdraw", [1]), value: 0n };
export function submitted(overrides: Partial<Submitted> = {}): Submitted {
  return { ...identity, hash: HASH, wait: vi.fn(async () => ({ hash: HASH, status: 1 })), ...overrides };
}
export function services(): WalletServices {
  return {
    connect: vi.fn<WalletServices["connect"]>().mockImplementation(async injected => connection({ injected })),
    readCampaigns: vi.fn<WalletServices["readCampaigns"]>().mockResolvedValue({ total: 0, start: 0, campaigns: [], now: 1000 }),
    prepare: vi.fn<WalletServices["prepare"]>().mockImplementation(async (current, intent) => {
      const expected = { from: current.account, to: current.config.address, chainId: current.chainId,
        data: contractInterface.encodeFunctionData(intent.method, intent.args), value: intent.value ?? 0n };
      return { expected, send: vi.fn(async () => submitted(expected)) };
    }),
    track: vi.fn<WalletServices["track"]>().mockResolvedValue({ hash: HASH, status: 1 }),
  };
}
