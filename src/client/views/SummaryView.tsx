import { AlertTriangle, ChevronRight, Plus, Target, Wallet } from "lucide-react";
import { formatBRL } from "../../shared/money";
import { monthLabel } from "../../shared/month";
import type { Goal, Summary } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { AccountIcon, Button, Card, CheckCircle, cx, Empty, List, Money, Progress, Row, Section } from "../ui";

export function SummaryView() {
  const { month, navigate, openSheet } = useApp();
  const summary = useData<Summary>(`/api/summary?month=${month}`).data;
  const goals = useData<Goal[]>(`/api/goals?month=${month}`).data ?? [];
  const { run } = useMutation();

  if (!summary) return <Skeleton />;
  const t = summary.totals;
  const monthName = monthLabel(month).split(" de ")[0];
  const goalsThisMonth = goals.filter((g) => g.month_planned_cents > 0);
  const nothing = t.total_cents === 0 && summary.by_account.length === 0 && goals.length === 0;

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <p className="text-sm font-medium text-muted">Gastos de {monthName}</p>
        <p className="num mt-1 text-[2.4rem] font-bold leading-none tracking-tight">{formatBRL(t.total_cents)}</p>
        <Composition
          items={[
            { label: "Parcelados", value: t.installments_cents, to: "expenses/installments", cls: "bg-accent" },
            { label: "Fixos", value: t.recurring_cents, to: "expenses/recurring", cls: "bg-accent/55" },
            { label: "Avulsos", value: t.one_off_cents, to: "expenses/one-off", cls: "bg-accent/30" },
          ]}
          total={t.total_cents}
          onOpen={navigate}
        />
        {t.income_cents != null && (
          <div className="mt-4 space-y-1.5">
            <Progress value={t.total_cents + Math.max(t.goals_planned_cents, t.goals_done_cents)} max={t.income_cents} />
            <div className="flex justify-between text-sm">
              <span className="text-muted">
                Renda <Money cents={t.income_cents} />
              </span>
              <span className={cx("font-semibold", t.leftover_cents! < 0 ? "text-danger" : "text-success")}>
                {t.leftover_cents! < 0 ? "Falta " : "Sobra "}
                <Money cents={Math.abs(t.leftover_cents!)} />
              </span>
            </div>
          </div>
        )}
        {t.budget_overflow_cents > 0 && (
          <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-danger">
            <AlertTriangle size={15} /> Orçamentos estourados em {formatBRL(t.budget_overflow_cents)}
          </p>
        )}
      </Card>

      {nothing && (
        <Empty
          icon={<Wallet size={22} />}
          title="Comece pelo básico"
          text="Cadastre seus cartões em Ajustes e lance seus fixos, parcelados e gastos do mês."
          action={<Button onClick={() => openSheet({ kind: "new" })}>Novo lançamento</Button>}
        />
      )}

      {summary.by_account.length > 0 && (
        <Section title="Por cartão / conta">
          <List>
            {summary.by_account.map((a) => (
              <Row
                key={a.account_id ?? "none"}
                left={
                  <span className="rounded-xl bg-surface-2 p-2 text-muted">
                    <AccountIcon type={a.type} size={18} />
                  </span>
                }
                title={a.name}
                subtitle={a.type === "credit" ? (a.due_day ? `Fatura vence dia ${a.due_day}` : "Fatura") : a.type ? "Gastos no mês" : "Lançamentos sem conta"}
                right={<Money cents={a.total_cents} className="font-semibold" />}
                onClick={a.account_id ? () => navigate(`expenses/one-off?account=${a.account_id}`) : undefined}
              />
            ))}
          </List>
          <p className="px-1 text-xs text-muted">Inclui parcelados, fixos, avulsos e a parte dos devedores passada em cada cartão.</p>
        </Section>
      )}

      {summary.budgets.length > 0 && (
        <Section title="Orçamentos do mês">
          <div className="grid gap-3 sm:grid-cols-2">
            {summary.budgets.map((b) => (
              <Card key={b.id} className="relative p-4">
                <button
                  type="button"
                  aria-label={`Ver gastos de ${b.description}`}
                  onClick={() => navigate(`expenses/one-off?budget=${b.id}`)}
                  className="absolute inset-0 rounded-2xl transition hover:bg-surface-2/40"
                />
                <div className="pointer-events-none relative">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{b.description}</p>
                      <p className="num text-sm text-muted">
                        {formatBRL(b.spent_cents)} de {formatBRL(b.limit_cents)}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label={`Lançar em ${b.description}`}
                      onClick={() => openSheet({ kind: "new", tab: "expense", budgetId: b.id })}
                      className="pointer-events-auto -mr-1 -mt-1 rounded-full bg-accent-soft p-2 text-accent transition hover:brightness-95"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                  <Progress value={b.spent_cents} max={b.limit_cents} className="mt-3" />
                  <p className={cx("mt-2 text-sm font-semibold", b.remaining_cents < 0 ? "text-danger" : "text-text")}>
                    {b.remaining_cents >= 0 ? `Restam ${formatBRL(b.remaining_cents)}` : `Estourou ${formatBRL(-b.remaining_cents)}`}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {t.receivable_pending_cents > 0 && (
        <Section title="A receber" action={<Money cents={t.receivable_pending_cents} className="text-sm font-semibold text-success" />}>
          <List>
            {summary.pending_by_person.map((p) => (
              <Row
                key={p.person}
                left={<Avatar name={p.person} />}
                title={p.person}
                subtitle={`${p.count} ${p.count === 1 ? "item" : "itens"} pendente${p.count === 1 ? "" : "s"}`}
                right={
                  <span className="flex items-center gap-1">
                    <Money cents={p.total_cents} className="font-semibold" />
                    <ChevronRight size={16} className="text-muted" />
                  </span>
                }
                onClick={() => navigate("receivables")}
              />
            ))}
          </List>
        </Section>
      )}

      {goalsThisMonth.length > 0 && (
        <Section
          title={`Aportes de ${monthName}`}
          action={
            <span className="num text-sm font-semibold text-muted">
              {formatBRL(t.goals_done_cents)} / {formatBRL(t.goals_planned_cents)}
            </span>
          }
        >
          <List>
            {goalsThisMonth.map((g) => {
              const done = g.month_contrib_cents >= g.month_planned_cents;
              return (
                <Row
                  key={g.id}
                  left={
                    <CheckCircle
                      checked={done}
                      label={done ? `Aporte em ${g.name} feito` : `Marcar aporte em ${g.name}`}
                      onClick={() =>
                        done
                          ? openSheet({ kind: "goal-detail", id: g.id })
                          : run(() => api.post(`/api/goals/${g.id}/check`, { month }), `Aporte em ${g.name} registrado`)
                      }
                    />
                  }
                  title={g.name}
                  subtitle={done ? "Feito ✓" : g.month_contrib_cents > 0 ? `${formatBRL(g.month_contrib_cents)} de ${formatBRL(g.month_planned_cents)}` : "Pendente"}
                  right={<Money cents={g.month_planned_cents} className={cx("font-semibold", done && "text-muted line-through")} />}
                  onClick={() => openSheet({ kind: "goal-detail", id: g.id })}
                />
              );
            })}
          </List>
        </Section>
      )}

      {goals.length === 0 && !nothing && (
        <Card className="flex items-center gap-3 p-4" onClick={() => navigate("goals")}>
          <span className="rounded-xl bg-accent-soft p-2 text-accent">
            <Target size={18} />
          </span>
          <div className="flex-1">
            <p className="font-semibold">Crie sua primeira meta</p>
            <p className="text-sm text-muted">Reserva, viagem, investimentos — com aporte mensal e check.</p>
          </div>
          <ChevronRight size={18} className="text-muted" />
        </Card>
      )}
    </div>
  );
}

function Composition({
  items,
  total,
  onOpen,
}: {
  items: { label: string; value: number; to: string; cls: string }[];
  total: number;
  onOpen: (to: string) => void;
}) {
  return (
    <div className="mt-5">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-2">
        {total > 0 && items.map((i) => <div key={i.label} className={i.cls} style={{ width: `${(i.value / total) * 100}%` }} />)}
      </div>
      <div className="mt-2 -mx-2">
        {items.map((i) => (
          <button
            key={i.label}
            type="button"
            onClick={() => onOpen(i.to)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-surface-2"
          >
            <span className={cx("h-2.5 w-2.5 rounded-full", i.cls)} />
            <span className="flex-1 text-[15px] text-muted">{i.label}</span>
            <span className="num text-[15px] font-semibold">{formatBRL(i.value)}</span>
            <ChevronRight size={16} className="text-muted" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{initials}</span>;
}

function Skeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <div className="h-44 animate-pulse rounded-2xl bg-surface" />
      <div className="h-32 animate-pulse rounded-2xl bg-surface" />
      <div className="h-24 animate-pulse rounded-2xl bg-surface" />
    </div>
  );
}
