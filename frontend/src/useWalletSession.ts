import { useCallback, useEffect, useRef, useState } from "react";
import { getError } from "./errors";
import { walletServices } from "./web3";
import type { InjectedWallet, Session, WalletServices } from "./web3";

type WalletState = { revision: number; session: Session | null; connecting: boolean; error: string; notice: string };

export function useWalletSession(services: WalletServices = walletServices) {
  const [state, setState] = useState<WalletState>({ revision: 0, session: null, connecting: false, error: "", notice: "" });
  const revision = useRef(0);
  const current = useRef<Session | null>(null);
  const pending = useRef<number | null>(null);
  const mounted = useRef(true);
  const unsubscribe = useRef<() => void>(() => {});

  const getSession = useCallback(() => current.current, []);
  const isCurrent = useCallback((session: Session) => mounted.current && current.current?.id === session.id && session.injected === window.ethereum, []);
  const invalidate = useCallback((notice: string) => {
    const id = ++revision.current;
    current.current = null;
    pending.current = null;
    if (mounted.current) setState({ revision: id, session: null, connecting: false, error: "", notice });
  }, []);
  const retire = useCallback(() => {
    mounted.current = false;
    unsubscribe.current();
    revision.current++;
    current.current = null;
    pending.current = null;
  }, []);

  const subscribe = useCallback((injected: InjectedWallet | undefined) => {
    unsubscribe.current();
    const accountsChanged = () => invalidate("Wallet account changed. Please reconnect.");
    const chainChanged = () => invalidate("Wallet network changed. Please reconnect.");
    const disconnected = () => invalidate("Wallet disconnected. Please reconnect.");
    injected?.on?.("accountsChanged", accountsChanged);
    injected?.on?.("chainChanged", chainChanged);
    injected?.on?.("disconnect", disconnected);
    unsubscribe.current = () => {
      injected?.removeListener?.("accountsChanged", accountsChanged);
      injected?.removeListener?.("chainChanged", chainChanged);
      injected?.removeListener?.("disconnect", disconnected);
    };
  }, [invalidate]);

  useEffect(() => {
    mounted.current = true;
    subscribe(window.ethereum);
    return retire;
  }, [subscribe, retire]);

  const connectWallet = useCallback(async () => {
    if (pending.current !== null) return;
    const id = ++revision.current;
    pending.current = id;
    current.current = null;
    setState({ revision: id, session: null, connecting: true, error: "", notice: "" });
    try {
      const injected = window.ethereum;
      if (!injected) throw new Error("Please install MetaMask or another compatible Ethereum wallet.");
      subscribe(injected);
      const connection = await services.connect(injected);
      if (!mounted.current || id !== revision.current) return;
      if (window.ethereum !== injected) {
        invalidate("Wallet provider changed. Please reconnect.");
        return;
      }
      const session = { ...connection, id };
      current.current = session;
      setState({ revision: id, session, connecting: false, error: "", notice: "Wallet and FundChain deployment verified." });
    } catch (error) {
      if (mounted.current && id === revision.current) {
        setState({ revision: id, session: null, connecting: false, error: getError(error), notice: "" });
      }
    } finally {
      if (pending.current === id) pending.current = null;
    }
  }, [services, subscribe, invalidate]);

  return { ...state, connectWallet, getSession, isCurrent };
}

export type WalletSession = ReturnType<typeof useWalletSession>;
