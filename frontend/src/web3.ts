import { BrowserProvider, Contract, getAddress, keccak256 } from "ethers";
import type { Eip1193Provider } from "ethers";
import { contractInterface, deployment, NETWORK_NAME } from "./contract";
import type { Deployment } from "./contract";

export type InjectedWallet = Eip1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
export type Connection = { account: string; chainId: bigint; injected: InjectedWallet; provider: BrowserProvider; config: Deployment };
export type Session = Connection & { id: number };
export type Campaign = { id: number; owner: string; goal: bigint; raised: bigint; deadline: number; withdrawn: boolean; contribution: bigint };
export const PAGE_SIZE = 12;
export type CampaignSnapshot = { total: number; start: number; campaigns: Campaign[]; now: number };
export type Intent = {
  method: "createCampaign" | "contribute" | "withdraw" | "refund" | "withdrawTo" | "refundTo";
  args: (string | number | bigint)[];
  value?: bigint;
  label: string;
};
export type Identity = { from: string; to: string | null; chainId: bigint; data: string; value: bigint };
export type Receipt = { hash: string; status: number | null };
export type Submitted = Identity & { hash: string; wait: (confirmations?: number, timeout?: number) => Promise<Receipt | null> };
export type Prepared = { expected: Identity; send: () => Promise<Submitted> };

function chainId(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("The wallet returned an invalid chain ID.");
  return BigInt(value);
}

function firstAccount(value: unknown): string {
  if (!Array.isArray(value) || typeof value[0] !== "string") throw new Error("No wallet account is available. Reconnect your wallet.");
  return getAddress(value[0]);
}

export async function verifyDeployment(provider: Pick<BrowserProvider, "getNetwork" | "getCode">, config: Deployment): Promise<void> {
  if ((await provider.getNetwork()).chainId !== config.chainId) {
    throw new Error(`Switch your wallet to ${NETWORK_NAME} (${config.chainId}).`);
  }
  const code = await provider.getCode(config.address);
  if (code === "0x") throw new Error("No contract exists at the configured address. Check your FundChain deployment.");
  if (keccak256(code) !== config.runtimeHash) {
    throw new Error("This address does not contain the reviewed FundChain contract. Check the configured deployment.");
  }
}

export async function connect(injected: InjectedWallet): Promise<Connection> {
  const config = deployment();
  const account = firstAccount(await injected.request({ method: "eth_requestAccounts" }));
  const actualChain = chainId(await injected.request({ method: "eth_chainId" }));
  if (actualChain !== config.chainId) throw new Error(`Switch your wallet to ${NETWORK_NAME} (${config.chainId}).`);
  const provider = new BrowserProvider(injected, undefined, { cacheTimeout: -1 });
  await verifyDeployment(provider, config);
  const connection = { account, chainId: actualChain, injected, provider, config };
  await assertIdentity(connection);
  return connection;
}

async function assertIdentity(session: Connection): Promise<void> {
  const account = firstAccount(await session.injected.request({ method: "eth_accounts" }));
  const actualChain = chainId(await session.injected.request({ method: "eth_chainId" }));
  if (account !== session.account || actualChain !== session.chainId) {
    throw new Error("Wallet account or network changed. Reconnect before continuing.");
  }
}

export async function readCampaigns(session: Session, start: number | null = null): Promise<CampaignSnapshot> {
  await assertIdentity(session);
  const block = await session.provider.getBlock("latest");
  if (!block) throw new Error("Cannot read the latest blockchain block.");
  const contract = new Contract(session.config.address, contractInterface, session.provider);
  const overrides = { blockTag: block.number };
  const rawCount: bigint = await contract.campaignCount(overrides);
  if (rawCount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Campaign count exceeds the supported range.");
  const campaigns: Campaign[] = [];
  const total = Number(rawCount);
  if (start !== null && (!Number.isSafeInteger(start) || start < 0)) throw new Error("Invalid campaign page.");
  const first = Math.min(start ?? total, total);
  const ids = Array.from({ length: Math.min(PAGE_SIZE, first) }, (_, i) => first - i);
  campaigns.push(...await Promise.all(ids.map(async id => {
    const [data, contribution] = await Promise.all([contract.campaigns(id, overrides), contract.contributions(id, session.account, overrides)]);
    const deadline: bigint = data.deadline;
    return { id, owner: getAddress(data.owner), goal: data.goal as bigint, raised: data.amountRaised as bigint,
      deadline: deadline <= 8_640_000_000_000n ? Number(deadline) : Infinity,
      withdrawn: data.withdrawn as boolean, contribution: contribution as bigint };
  })));
  await assertIdentity(session);
  return { total, start: first, campaigns, now: block.timestamp * 1000 };
}

export async function prepare(session: Session, intent: Intent): Promise<Prepared> {
  await assertIdentity(session);
  // A fresh provider avoids reusing a cached network/code result when preparing a write.
  const provider = new BrowserProvider(session.injected, undefined, { cacheTimeout: -1 });
  await verifyDeployment(provider, session.config);
  const signer = await provider.getSigner(session.account);
  await assertIdentity(session);
  const expected: Identity = { from: session.account, to: session.config.address, chainId: session.chainId,
    data: contractInterface.encodeFunctionData(intent.method, intent.args), value: intent.value ?? 0n };
  return { expected, send: () => signer.sendTransaction(expected) };
}

export function sameIntent(actual: Identity, expected: Identity): boolean {
  try {
    return getAddress(actual.from) === getAddress(expected.from) && actual.to !== null && expected.to !== null &&
      getAddress(actual.to) === getAddress(expected.to) && actual.chainId === expected.chainId &&
      actual.data.toLowerCase() === expected.data.toLowerCase() && actual.value === expected.value;
  } catch { return false; }
}

export async function track(session: Session, hash: string): Promise<Receipt | null> {
  await assertIdentity(session);
  return new BrowserProvider(session.injected, undefined, { cacheTimeout: -1 }).waitForTransaction(hash, 1, 60_000);
}

export const walletServices = { connect, readCampaigns, prepare, track };
export type WalletServices = typeof walletServices;
