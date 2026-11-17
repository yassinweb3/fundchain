import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { WalletServices } from "./web3";
import AppFrame from "./components/AppFrame";
import { loadWorkspace } from "./loadWorkspace";
import "./App.css";
type Workspace = ComponentType<{
  services?: WalletServices;
}>;
export default function App({ services }: {
  services?: WalletServices;
}) {
  const [workspace, setWorkspace] = useState<{
    Component: Workspace;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  async function openWallet() {
    if (pending.current)
      return;
    pending.current = true;
    setLoading(true);
    setError(false);
    try {
      const module = await loadWorkspace();
      if (mounted.current)
        setWorkspace({ Component: module.default });
    }
    catch {
      if (mounted.current)
        setError(true);
    }
    finally {
      pending.current = false;
      if (mounted.current)
        setLoading(false);
    }
  }
  // Once loaded, the workspace never leaves this branch. Its transaction controller
  // stays mounted across session, form, and pagination changes.
  if (workspace) {
    const { Component } = workspace;
    return <Component services={services} />;
  }
  return <AppFrame onConnect={() => { void openWallet(); }} connecting={loading}>
    <section id="campaigns" className="empty-state" aria-busy={loading}>
      <h2>{loading ? "Loading wallet tools..." : "Connect your wallet"}</h2>
      {error && <p role="alert">Wallet tools could not be loaded. Check your connection and retry. If the app was updated, reload the page.</p>}
      {loading ? <p role="status">Preparing secure wallet connection...</p> :
        <button className="primary-button" onClick={() => { void openWallet(); }}>{error ? "Retry wallet tools" : "Connect Wallet"}</button>}
    </section>
  </AppFrame>;
}
