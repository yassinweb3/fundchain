import type { ReactNode } from "react";
import heroImage from "../assets/hero.png";
export type WalletControls = {
  account: string;
  connecting: boolean;
  onConnect: () => void;
};
const NETWORK_NAME = import.meta.env.VITE_NETWORK_NAME ?? "Anvil Local";
export default function AppFrame({ account = "", connecting = false, onConnect, children }: {
  account?: string;
  connecting?: boolean;
  onConnect: () => void;
  children: ReactNode;
}) {
  return (<div className="app">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="header">
      <div className="brand">
        <div className="brand-icon">◆</div>

        <span>FundChain</span>

        <span className="testnet">{NETWORK_NAME}</span>
      </div>

      <button type="button" className="wallet-button" onClick={onConnect} disabled={connecting}>
        {account ? (<>● {`${account.slice(0, 6)}...${account.slice(-4)}`}</>) : connecting ? ("Connecting...") : ("Connect Wallet")}
      </button>
    </header>

    <main className="container" id="main" tabIndex={-1}>
      <section className="hero">
        <div className="hero-content">
          <div className="eyebrow">DECENTRALIZED CROWDFUNDING</div>

          <h1>
            Fund ideas.
            <br />
            <span>Build the future.</span>
          </h1>

          <p>
            Create campaigns, support projects, and manage funding
            transparently on the configured blockchain.
          </p>

          <a className="primary-link" href="#campaigns">
            Explore Campaigns →
          </a>
        </div>

        <div className="hero-art" aria-hidden="true">
          <div className="hero-glow" />
          <div className="hero-orbit hero-orbit-one" />
          <div className="hero-orbit hero-orbit-two" />

          <img src={heroImage} alt="" className="hero-image" />

          <div className="hero-badge hero-badge-top">
            <span className="hero-badge-dot" />
            Smart Contract
          </div>

          <div className="hero-badge hero-badge-bottom">◆ On-chain</div>
        </div>
      </section>

      {children}
    </main>

    <footer className="footer">
      <span>◆ FundChain</span>

      <span>Built with React, Solidity & Ethereum</span>

      <span>{NETWORK_NAME}</span>
    </footer>
  </div>);
}
