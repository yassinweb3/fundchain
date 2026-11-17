import { useCallback, useEffect, useRef, useState } from "react";
import { getError } from "./errors";
import { PAGE_SIZE, walletServices } from "./web3";
import type { CampaignSnapshot, Session, WalletServices } from "./web3";
type ReadState = {
  id: number;
  version: number;
  snapshot: CampaignSnapshot | null;
  refreshing: boolean;
  error: string;
};
export function useCampaigns(session: Session | null, isCurrent: (session: Session) => boolean, services: WalletServices = walletServices) {
  const [state, setState] = useState<ReadState>({ id: -1, version: 0, snapshot: null, refreshing: false, error: "" });
  const selection = useRef({ id: -1, version: 0, start: null as number | null });
  const lock = useRef<{
    id: number;
    version: number;
    promise: Promise<boolean>;
  } | null>(null);
  const mounted = useRef(true);
  const refresh = useCallback((): Promise<boolean> => {
    if (!session || !mounted.current || !isCurrent(session))
      return Promise.resolve(false);
    if (selection.current.id !== session.id)
      selection.current = { id: session.id, version: 0, start: null };
    const query = { ...selection.current };
    if (lock.current?.id === query.id && lock.current.version === query.version)
      return lock.current.promise;
    const token = { id: query.id, version: query.version, promise: Promise.resolve(false) };
    lock.current = token;
    const valid = () => mounted.current && isCurrent(session) && selection.current.id === query.id && selection.current.version === query.version;
    setState(previous => ({ id: query.id, version: query.version, snapshot: previous.id === query.id && previous.version === query.version ? previous.snapshot : null, refreshing: true, error: "" }));
    token.promise = (async () => {
      try {
        const snapshot = await services.readCampaigns(session, query.start);
        if (!valid())
          return false;
        selection.current.start = snapshot.start;
        setState({ id: query.id, version: query.version, snapshot, refreshing: false, error: "" });
        return true;
      }
      catch (error) {
        if (valid())
          setState(previous => ({ ...previous, refreshing: false, error: getError(error) }));
        return false;
      }
      finally {
        if (lock.current === token)
          lock.current = null;
      }
    })();
    return token.promise;
  }, [session, isCurrent, services]);
  const refreshAfterTransaction = useCallback(async () => {
    const existing = lock.current;
    if (existing && session && existing.id === session.id)
      await existing.promise;
    return refresh();
  }, [session, refresh]);
  const navigate = useCallback((start: number | null) => {
    if (!session || !isCurrent(session))
      return;
    if (selection.current.id === session.id && selection.current.start === start) return;
    selection.current = { id: session.id, version: selection.current.version + 1, start };
    void refresh();
  }, [session, isCurrent, refresh]);
  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scheduleVersion = 0;
    const visible = () => document.visibilityState !== "hidden";
    const poll = async (version: number) => {
      if (stopped || !visible() || version !== scheduleVersion)
        return;
      await refresh();
      if (!stopped && visible() && version === scheduleVersion) {
        timer = setTimeout(() => { void poll(version); }, 10000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      const version = ++scheduleVersion;
      if (visible())
        timer = setTimeout(() => { void poll(version); }, 0);
    };
    document.addEventListener("visibilitychange", visibility);
    visibility();
    return () => {
      mounted.current = false;
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [refresh]);
  const snapshot = state.id === session?.id ? state.snapshot : null;
  return {
    snapshot,
    refreshing: state.id === session?.id && state.refreshing,
    error: state.id === session?.id ? state.error : "",
    refresh, refreshAfterTransaction,
    older: () => {
      if (snapshot && snapshot.start > PAGE_SIZE)
        navigate(snapshot.start - PAGE_SIZE);
    },
    newer: () => {
      if (snapshot && snapshot.start < snapshot.total)
        navigate(Math.min(snapshot.start + PAGE_SIZE, snapshot.total));
    },
    newest: () => navigate(null),
  };
}
