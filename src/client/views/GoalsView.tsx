import { PiggyBank, Plus } from "lucide-react";
import { formatBRL } from "../../shared/money";
import { monthLabel } from "../../shared/month";
import type { Goal } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Button, Card, CheckCircle, cx, Empty, Progress } from "../ui";
import { ListSkeleton } from "./ExpensesView";

export function GoalsView() {
  const { month, openSheet } = useApp();
  const goals = useData<Goal[]>(`/api/goals?month=${month}`).data;
  const { run } = useMutation();
  if (!goals) return <ListSkeleton />;

  const total = goals.reduce((s, g) => s + g.balance_cents, 0);
  const planned = goals.reduce((s, g) => s + g.month_planned_cents, 0);
  const done = goals.reduce((s, g) => s + Math.max(Math.min(g.month_contrib_cents, g.month_planned_cents), 0), 0);
  const monthName = monthLabel(month).split(" de ")[0];

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <p className="text-sm font-medium text-muted">Total guardado</p>
        <p className="num mt-1 text-[2.2rem] font-bold leading-none tracking-tight">{formatBRL(total)}</p>
        {planned > 0 && (
          <div className="mt-4 space-y-1.5">
            <Progress value={done} max={planned} goal />
            <p className="text-sm text-muted">
              Aportes de {monthName}: <b className="num text-text">{formatBRL(done)}</b> de <span className="num">{formatBRL(planned)}</span>
            </p>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between px-1">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Metas e investimentos</h2>
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "goal" })}>
          <Plus size={16} /> Nova meta
        </Button>
      </div>

      {goals.length === 0 ? (
        <Empty
          icon={<PiggyBank size={22} />}
          title="Nenhuma meta ainda"
          text="Cadastre o que você já tem investido, defina um alvo e um aporte mensal. Todo mês é só dar o check."
          action={<Button onClick={() => openSheet({ kind: "goal" })}>Criar meta</Button>}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {goals.map((g) => {
            const monthDone = g.month_planned_cents > 0 && g.month_contrib_cents >= g.month_planned_cents;
            const pct = g.target_cents ? Math.floor((g.balance_cents / g.target_cents) * 100) : null;
            return (
              <Card key={g.id} className="relative p-4">
                <button type="button" aria-label={`Abrir ${g.name}`} onClick={() => openSheet({ kind: "goal-detail", id: g.id })} className="absolute inset-0 rounded-2xl transition hover:bg-surface-2/40" />
                <div className="pointer-events-none relative space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{g.name}</p>
                      {g.institution && <p className="truncate text-sm text-muted">{g.institution}</p>}
                    </div>
                    {g.month_planned_cents > 0 && (
                      <span className="pointer-events-auto">
                        <CheckCircle
                          checked={monthDone}
                          label={monthDone ? `Aporte de ${monthName} feito` : `Marcar aporte de ${monthName}`}
                          onClick={() =>
                            monthDone
                              ? openSheet({ kind: "goal-detail", id: g.id })
                              : run(() => api.post(`/api/goals/${g.id}/check`, { month }), `Aporte em ${g.name} registrado ✓`)
                          }
                        />
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="num text-xl font-bold">{formatBRL(g.balance_cents)}</span>
                    {g.target_cents ? <span className="num text-sm text-muted">de {formatBRL(g.target_cents)}</span> : null}
                  </div>
                  {g.target_cents ? <Progress value={g.balance_cents} max={g.target_cents} goal /> : null}
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted">
                    {pct != null && <span className={cx("font-semibold", pct >= 100 ? "text-success" : "text-text")}>{pct}%</span>}
                    {g.monthly_cents ? <span>aporte {formatBRL(g.monthly_cents)}/mês</span> : null}
                    {g.eta_month && pct != null && pct < 100 && <span>previsão {monthLabel(g.eta_month, true)}</span>}
                    {g.required_monthly_cents && g.monthly_cents && g.required_monthly_cents > g.monthly_cents ? (
                      <span className="text-warn">precisa {formatBRL(g.required_monthly_cents)}/mês p/ o prazo</span>
                    ) : null}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
