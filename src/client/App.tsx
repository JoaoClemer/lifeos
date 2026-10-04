import { ChevronLeft, ChevronRight, HandCoins, LayoutDashboard, Plus, Receipt, Settings, Target, Wallet } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { addMonths, monthTitle } from "../shared/month";
import { api, setUnauthorizedHandler } from "./api";
import { SheetHost } from "./SheetHost";
import { AppProvider, clearCache, useApp } from "./state";
import { Button, cx, TextInput } from "./ui";
import { ExpensesView } from "./views/ExpensesView";
import { GoalsView } from "./views/GoalsView";
import { ReceivablesView } from "./views/ReceivablesView";
import { SettingsView } from "./views/SettingsView";
import { SummaryView } from "./views/SummaryView";

type Auth = "checking" | "in" | "out";

export default function App() {
  const [auth, setAuth] = useState<Auth>("checking");
  useEffect(() => {
    setUnauthorizedHandler(() => setAuth("out"));
    api
      .get("/api/me")
      .then(() => setAuth("in"))
      .catch(() => setAuth("out"));
  }, []);

  if (auth === "checking") return <div className="min-h-dvh bg-bg" />;
  if (auth === "out") return <Login onLogin={() => setAuth("in")} />;
  return (
    <AppProvider>
      <Shell
        onLogout={() => {
          clearCache();
          setAuth("out");
        }}
      />
    </AppProvider>
  );
}

const NAV = [
  { view: "summary", label: "Resumo", icon: LayoutDashboard, title: "Resumo", month: true },
  { view: "expenses", label: "Gastos", icon: Receipt, title: "Gastos", month: true },
  { view: "receivables", label: "Devedores", icon: HandCoins, title: "Devedores", month: false },
  { view: "goals", label: "Metas", icon: Target, title: "Metas e investimentos", month: true },
  { view: "settings", label: "Ajustes", icon: Settings, title: "Ajustes", month: false },
] as const;

function Shell({ onLogout }: { onLogout: () => void }) {
  const { route, navigate, openSheet, toasts } = useApp();
  const current = NAV.find((n) => n.view === route.view) ?? NAV[0];

  // Atalho do app instalado: /?novo=gasto abre direto o lançamento
  useEffect(() => {
    if (new URLSearchParams(location.search).has("novo")) {
      openSheet({ kind: "new" });
      history.replaceState(null, "", location.pathname + location.hash);
    }
  }, [openSheet]);

  let page: ReactNode;
  switch (current.view) {
    case "expenses":
      page = <ExpensesView />;
      break;
    case "receivables":
      page = <ReceivablesView />;
      break;
    case "goals":
      page = <GoalsView />;
      break;
    case "settings":
      page = <SettingsView onLogout={onLogout} />;
      break;
    default:
      page = <SummaryView />;
  }

  return (
    <div className="min-h-dvh bg-bg md:flex">
      {/* Sidebar (desktop) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 md:flex">
        <div className="mb-6 flex items-center gap-2 px-3">
          <span className="rounded-xl bg-accent p-1.5 text-accent-fg">
            <Wallet size={18} />
          </span>
          <span className="text-lg font-bold tracking-tight">Finanças</span>
        </div>
        <Button className="mb-4 w-full" onClick={() => openSheet({ kind: "new" })}>
          <Plus size={18} /> Novo lançamento
        </Button>
        <nav className="space-y-1">
          {NAV.map((n) => (
            <button
              key={n.view}
              type="button"
              onClick={() => navigate(n.view)}
              aria-current={current.view === n.view ? "page" : undefined}
              className={cx(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition",
                current.view === n.view ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
              )}
            >
              <n.icon size={19} /> {n.label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="pt-safe sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4 md:h-16 md:px-8">
            <h1 className={cx("truncate text-lg font-bold tracking-tight md:text-xl", current.month && "hidden sm:block")}>{current.title}</h1>
            {current.month && <MonthSwitcher />}
            <button
              type="button"
              aria-label="Ajustes"
              onClick={() => navigate("settings")}
              className={cx("rounded-full p-2 text-muted hover:bg-surface-2 md:hidden", current.view === "settings" && "invisible")}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 pb-32 pt-4 md:px-8 md:pb-16 md:pt-6">{page}</main>
      </div>

      {/* Navegação inferior (mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md md:hidden">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {NAV.slice(0, 2).map((n) => (
            <NavItem key={n.view} active={current.view === n.view} label={n.label} icon={<n.icon size={22} />} onClick={() => navigate(n.view)} />
          ))}
          <div className="flex justify-center">
            <button
              type="button"
              aria-label="Novo lançamento"
              onClick={() => openSheet({ kind: "new" })}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-fg shadow-lg shadow-accent/30 transition active:scale-95"
            >
              <Plus size={28} strokeWidth={2.5} />
            </button>
          </div>
          {NAV.slice(2, 4).map((n) => (
            <NavItem key={n.view} active={current.view === n.view} label={n.label} icon={<n.icon size={22} />} onClick={() => navigate(n.view)} />
          ))}
        </div>
      </nav>

      <SheetHost />

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "animate-sheet rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg",
              t.tone === "error" ? "bg-danger text-white" : "bg-text text-bg",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}

function NavItem({ active, label, icon, onClick }: { active: boolean; label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cx("flex flex-col items-center gap-0.5 text-[11px] font-semibold transition", active ? "text-accent" : "text-muted")}
    >
      {icon}
      {label}
    </button>
  );
}

function MonthSwitcher() {
  const { month, setMonth, currentMonth } = useApp();
  const isCurrent = month === currentMonth;
  return (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))} className="rounded-full p-2 text-muted hover:bg-surface-2">
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        onClick={() => setMonth(currentMonth)}
        className="min-w-[9.5rem] text-center text-[15px] font-semibold"
        title={isCurrent ? undefined : "Voltar para o mês atual"}
      >
        {monthTitle(month)}
        {!isCurrent && <span className="ml-1.5 rounded-md bg-accent-soft px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase text-accent">hoje</span>}
      </button>
      <button type="button" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))} className="rounded-full p-2 text-muted hover:bg-surface-2">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/login", { password });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-3 text-center">
          <span className="inline-flex rounded-2xl bg-accent p-3 text-accent-fg">
            <Wallet size={28} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Finanças</h1>
          <p className="text-sm text-muted">Digite sua senha para entrar.</p>
        </div>
        <TextInput
          type="password"
          autoComplete="current-password"
          placeholder="Senha"
          aria-label="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
        {error && <p className="text-center text-sm font-medium text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy || !password}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
    </div>
  );
}
