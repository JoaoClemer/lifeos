import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { todayIn } from "../shared/month";
import type { Account, Expense, Goal, Income, Installment, Receivable, Recurring } from "../shared/types";
import { api } from "./api";

export type NewTab = "expense" | "installment" | "recurring" | "receivable" | "income";

export type SheetState =
  | { kind: "new"; tab?: NewTab; budgetId?: number }
  | { kind: "expense"; item: Expense }
  | { kind: "installment"; item: Installment }
  | { kind: "recurring"; item: Recurring }
  | { kind: "receivable"; item: Receivable }
  | { kind: "income"; item: Income }
  | { kind: "goal"; item?: Goal }
  | { kind: "goal-detail"; id: number }
  | { kind: "account"; item?: Account };

export interface Route {
  view: string;
  sub?: string;
  params: URLSearchParams;
}

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
}

interface AppState {
  today: string;
  currentMonth: string;
  month: string;
  setMonth: (m: string) => void;
  version: number;
  refresh: () => void;
  toast: (text: string, tone?: "ok" | "error") => void;
  toasts: Toast[];
  sheet: SheetState | null;
  openSheet: (s: SheetState) => void;
  closeSheet: () => void;
  route: Route;
  navigate: (path: string) => void;
}

const Ctx = createContext<AppState | null>(null);

function parseRoute(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const [view, sub] = path.split("/");
  return { view: view || "summary", sub: sub || undefined, params: new URLSearchParams(query ?? "") };
}

export function AppProvider({ children }: { children: ReactNode }) {
  const today = useMemo(() => todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const currentMonth = today.slice(0, 7);
  const [month, setMonth] = useState(currentMonth);
  const [version, setVersion] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [route, setRoute] = useState<Route>(parseRoute);
  const toastId = useRef(0);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  const toast = useCallback((text: string, tone: "ok" | "error" = "ok") => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 4500 : 2500);
  }, []);
  const navigate = useCallback((path: string) => {
    location.hash = path.startsWith("/") ? path : `/${path}`;
    window.scrollTo({ top: 0 });
  }, []);

  const value: AppState = {
    today,
    currentMonth,
    month,
    setMonth,
    version,
    refresh,
    toast,
    toasts,
    sheet,
    openSheet: setSheet,
    closeSheet: useCallback(() => setSheet(null), []),
    route,
    navigate,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp fora do AppProvider");
  return v;
}

// Cache simples (stale-while-revalidate): mostra o último dado na hora e recarrega a cada `refresh()`.
const cache = new Map<string, unknown>();

export function useData<T>(path: string | null): { data: T | undefined; error: string | null } {
  const { version } = useApp();
  const [data, setData] = useState<T | undefined>(() => (path ? (cache.get(path) as T) : undefined));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setData(cache.get(path) as T | undefined);
    api
      .get<T>(path)
      .then((d) => {
        if (!alive) return;
        cache.set(path, d);
        setData(d);
        setError(null);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [path, version]);
  return { data, error };
}

export function clearCache() {
  cache.clear();
}

/** Executa uma mutação com toast de sucesso/erro e recarrega os dados. */
export function useMutation() {
  const { refresh, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        const r = await fn();
        refresh();
        if (success) toast(success);
        return r;
      } catch (e) {
        toast(e instanceof Error ? e.message : "Erro", "error");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast],
  );
  return { run, busy };
}
