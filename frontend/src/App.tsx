import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { WalletServices } from "./web3";
import AppFrame from "./components/AppFrame";
import type { WalletControls } from "./components/AppFrame";
import { loadWorkspace } from "./loadWorkspace";
import "./App.css";
type Workspace = ComponentType<{
  services?: WalletServices;
  onControlsChange?: (controls: WalletControls) => void;
}>;
export default function App({ services }: {
  services?: WalletServices;
}) {
  const [workspace, setWorkspace] = useState<{
    Component: Workspace;
  } | null>(null);
  const [controls, setControls] = useState<WalletControls | null>(null);
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
  const Component = workspace?.Component;
  // Keep the frame and clicked control mounted while only the workspace loads.
  return <AppFrame account={controls?.account} connecting={loading || controls?.connecting || (!!workspace && !controls)}
    onConnect={() => { if (workspace) controls?.onConnect(); else void openWallet(); }}>
    {Component ? <Component services={services} onControlsChange={setControls} /> :
      <section id="campaigns" className="empty-state" aria-busy={loading}>
        <h2>{loading ? "Loading wallet tools..." : "Connect your wallet"}</h2>
        {error && <p role="alert">Wallet tools could not be loaded. Check your connection and retry. If the app was updated, reload the page.</p>}
        {loading ? <p role="status">Preparing secure wallet connection...</p> :
          <button type="button" className="primary-button" onClick={() => { void openWallet(); }}>{error ? "Retry wallet tools" : "Connect Wallet"}</button>}
      </section>}
  </AppFrame>;
}
