import { getAddress, Interface, ZeroAddress } from "ethers";
import { CONTRACT_ABI, EXPECTED_RUNTIME_HASH } from "./contract.generated";

export { CONTRACT_ABI, EXPECTED_RUNTIME_HASH };
export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS ?? "0x5FbDB2315678afecb367f032d93F642f64180aa3";
export const CHAIN_ID_TEXT = import.meta.env.VITE_CHAIN_ID ?? "31337";
export const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME ?? "Anvil Local";
export const contractInterface = new Interface(CONTRACT_ABI);

export type Deployment = { address: string; chainId: bigint; runtimeHash: string };

export function deployment(): Deployment {
  if (!/^[1-9]\d*$/.test(CHAIN_ID_TEXT)) throw new Error("Invalid configured chain ID.");
  const address = getAddress(CONTRACT_ADDRESS);
  if (address === ZeroAddress) throw new Error("Configure a nonzero FundChain contract address.");
  return { address, chainId: BigInt(CHAIN_ID_TEXT), runtimeHash: EXPECTED_RUNTIME_HASH };
}

export function payoutRecipient(value: string, contractAddress = deployment().address): string | undefined {
  if (!value.trim()) return undefined;
  let address: string;
  try { address = getAddress(value.trim()); }
  catch { throw new Error("Enter a valid recipient address, including its checksum when mixed case is used."); }
  if (address === ZeroAddress || address === getAddress(contractAddress)) {
    throw new Error("The recipient cannot be the zero address or the FundChain contract.");
  }
  return address;
}
