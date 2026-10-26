import { ChevronDown, HandCoins, LogOut } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { formatBRL } from "../../shared/money";
import { formatDateBR, monthLabel } from "../../shared/month";
import type { DebtorItem, DebtorStatement } from "../../shared/receivables";
import { api, ApiError } from "../api";
import { Avatar, Badge, Button, Card, cx, Field, inputCls, List, LoadError, Money, Row, Section, TextInput } from "../ui";

// Página pública /devedor: a pessoa escolhe o nome, digita o código que recebeu e vê o que está em aberto.

type Auth = "checking" | "in" | "out";

export function DebtorApp() {
  const [auth, setAuth] = useState<Auth>("checking");
  const [statement, setStatement] = useState<DebtorStatement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<DebtorStatement>("/api/debtor/statement")
      .then((s) => {
        setStatement(s);
        setAuth("in");
      })
      .catch((e: Error) => {
        if (e instanceof ApiError && e.status === 401) setAuth("out");
        else setError(e.message);
      });
  }, []);
  useEffect(load, [load]);

  async function logout() {
    await api.post("/api/debtor/logout").catch(() => {});
    setStatement(null);
    setAuth("out");
  }

  return (
    <div className="pt-safe pb-safe min-h-dvh bg-bg">
      <main className="mx-auto max-w-lg px-4 py-6">
        {error ? (
          <LoadError error={error} onRetry={load} />
        ) : auth === "out" ? (
          <Login onLogin={load} />
        ) : auth === "in" && statement ? (
          <Statement s={statement} onLogout={logout} />
        ) : null}
      </main>
    </div>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [people, setPeople] = useState<string[] | null>(null);
  const [person, setPerson] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<string[]>("/api/debtor/people")
      .then((p) => {
        setPeople(p);
        if (p.length === 1) setPerson(p[0]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/debtor/login", { person, code });
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[80dvh] items-center justify-center">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5">
        <div className="space-y-3 text-center">
          <span className="inline-flex rounded-2xl bg-accent p-3 text-accent-fg">
            <HandCoins size={28} strokeWidth={2.25} />
          </span>
          <h1 className="text-2xl font-bold tracking-tight">Acerto de contas</h1>
          <p className="text-sm text-muted">Escolha seu nome e digite o código que você recebeu para ver os valores em aberto.</p>
        </div>
        {people && people.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted">Nenhum acesso liberado por enquanto.</p>
        ) : (
          <>
            <Field label="Seu nome" htmlFor="person">
              <div className="relative">
                <select
                  id="person"
                  className={cx(inputCls, "appearance-none pr-10", !person && "text-muted")}
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                  disabled={!people}
                  autoComplete="username"
                >
                  <option value="" disabled>
                    {people ? "Selecione…" : "Carregando…"}
                  </option>
                  {people?.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <ChevronDown size={18} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
              </div>
            </Field>
            <Field label="Código" htmlFor="code">
              <TextInput
                id="code"
                type="password"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            </Field>
            {error && (
              <p role="alert" className="text-center text-sm font-medium text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy || !person || !code.trim()}>
              {busy ? "Entrando…" : "Ver meus valores"}
            </Button>
          </>
        )}
      </form>
    </div>
  );
}

function Statement({ s, onLogout }: { s: DebtorStatement; onLogout: () => void }) {
  const firstName = s.person.split(/\s+/)[0];
  const lastUpcoming = s.upcoming[s.upcoming.length - 1];
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Avatar name={s.person} />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">Olá, {firstName}</h1>
        <Button variant="ghost" className="h-9 px-3 text-sm" onClick={onLogout}>
          <LogOut size={16} /> Sair
        </Button>
      </header>

      <Card className="px-5 py-6 text-center">
        {s.due_cents > 0 ? (
          <>
            <p className="text-sm text-muted">Em aberto</p>
            <p className="num mt-1 text-4xl font-bold tracking-tight">{formatBRL(s.due_cents)}</p>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold">Tudo em dia 🎉</p>
            <p className="mt-1 text-sm text-muted">Nada em aberto agora.</p>
          </>
        )}
        {lastUpcoming && (
          <p className="mt-3 text-sm text-muted">
            + <span className="num font-semibold text-text">{formatBRL(s.upcoming_cents)}</span> em parcelas futuras, até{" "}
            {monthLabel(lastUpcoming.month, true)}
          </p>
        )}
      </Card>

      {s.due.length > 0 && (
        <Section title="Em aberto">
          <List>
            {s.due.map((i, k) => (
              <ItemRow key={k} item={i} />
            ))}
          </List>
        </Section>
      )}

      {s.upcoming.length > 0 && (
        <Section title="Próximas parcelas">
          <List>
            {s.upcoming.map((i, k) => (
              <ItemRow key={k} item={i} />
            ))}
          </List>
        </Section>
      )}

      {s.paid.length > 0 && <Paid items={s.paid} />}

      <p className="px-4 text-center text-xs text-muted">Os valores são atualizados assim que um pagamento é registrado.</p>
    </div>
  );
}

function ItemRow({ item }: { item: DebtorItem }) {
  return (
    <Row
      title={item.description}
      subtitle={
        <>
          {item.installment_no ? (
            <Badge tone="accent">
              parcela {item.installment_no}/{item.installment_total} · {monthLabel(item.month, true)}
            </Badge>
          ) : (
            <span>{formatDateBR(item.date)}</span>
          )}
          {item.received_at && <Badge tone="success">pago em {formatDateBR(item.received_at)}</Badge>}
        </>
      }
      right={<Money cents={item.amount_cents} className={cx("font-semibold", item.received_at && "text-muted")} />}
    />
  );
}

/** Histórico do que já foi pago, recolhido por padrão. */
function Paid({ items }: { items: DebtorItem[] }) {
  const [open, setOpen] = useState(false);
  const total = items.reduce((s, i) => s + i.amount_cents, 0);
  return (
    <Card className="overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition hover:bg-surface-2"
      >
        <ChevronDown size={16} className={cx("text-muted transition", open && "rotate-180")} />
        <span className="flex-1 font-medium">Já pagos ({items.length})</span>
        <Money cents={total} className="font-semibold text-success" />
      </button>
      {open && (
        <div className="divide-y divide-border border-t border-border">
          {items.map((i, k) => (
            <ItemRow key={k} item={i} />
          ))}
        </div>
      )}
    </Card>
  );
}
