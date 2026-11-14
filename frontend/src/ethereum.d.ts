import type { InjectedWallet } from "./web3";

declare global {
  interface Window {
    ethereum?: InjectedWallet;
  }
}

export {};
