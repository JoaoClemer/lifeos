import { Layers, Plus, Receipt, Repeat, X } from "lucide-react";
import { useState } from "react";
import { formatBRL } from "../../shared/money";
import { monthLabel } from "../../shared/month";
import type { Account, Expense, Installment, Recurring } from "../../shared/types";
import { api } from "../api";
import { useAccounts } from "../forms/common";
import { ExpenseRow } from "./ExpenseRow";
import { type NewTab, useApp, useData, useMutation } from "../state";
import { AccountIcon, Badge, Button, CheckCircle, Chips, cx, Empty, List, Money, Progress, Row, Section, Segmented } from "../ui";

type Sub = "one-off" | "installments" | "recurring";

export function ExpensesView() {
  const { route, navigate } = useApp();
  const sub = (["one-off", "installments", "recurring"].includes(route.sub ?? "") ? route.sub : "one-off") as Sub;
  return (
    <div className="space-y-5">
      <Segmented<Sub>
        options={[
          { value: "one-off", label: "Avulsos" },
          { value: "installments", label: "Parcelados" },
          { value: "recurring", label: "Fixos" },
        ]}
        value={sub}
        onChange={(v) => navigate(`expenses/${v}`)}
      />
      {sub === "one-off" && <OneOffList />}
      {sub === "installments" && <InstallmentList />}
      {sub === "recurring" && <RecurringList />}
    </div>
  );
}

function AddButton({ tab, label }: { tab: NewTab; label: string }) {
  const { openSheet } = useApp();
  return (
    <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "new", tab })}>
      <Plus size={16} /> {label}
    </Button>
  );
}

function accountMap(accounts: Account[]) {
  return new Map(accounts.map((a) => [a.id, a]));
}

const WEEKDAY = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (date: string) => {
  const s = WEEKDAY.format(new Date(`${date}T12:00:00Z`)).replace(/\./g, "");
  return s[0].toUpperCase() + s.slice(1);
};

function OneOffList() {
  const { month, route, navigate } = useApp();
  const accountFilter = route.params.get("account") ? Number(route.params.get("account")) : null;
  const budgetFilter = route.params.get("budget") ? Number(route.params.get("budget")) : null;
  const expenses = useData<Expense[]>(`/api/expenses?month=${month}`).data;
  const recurring = useData<Recurring[]>(`/api/recurring?month=${month}&all=1`).data ?? [];
  const accounts = useAccounts();
  const accs = accountMap(accounts);
  const budgets = new Map(recurring.filter((r) => r.is_budget).map((r) => [r.id, r]));

  if (!expenses) return <ListSkeleton />;
  const filtered = expenses.filter((e) => (!accountFilter || e.account_id === accountFilter) && (!budgetFilter || e.budget_id === budgetFilter));
  const outside = filtered.filter((e) => !e.budget_id).reduce((s, e) => s + e.amount_cents, 0);
  const inBudgets = filtered.filter((e) => e.budget_id).reduce((s, e) => s + e.amount_cents, 0);
  const usedAccounts = accounts.filter((a) => expenses.some((e) => e.account_id === a.id));

  const groups = new Map<string, Expense[]>();
  for (const e of filtered) groups.set(e.date, [...(groups.get(e.date) ?? []), e]);

  const setFilter = (key: string, value: number | null) => {
    const p = new URLSearchParams(route.params);
    if (value) p.set(key, String(value));
    else p.delete(key);
    navigate(`expenses/one-off${p.size ? `?${p}` : ""}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="num text-2xl font-bold">{formatBRL(budgetFilter ? inBudgets : outside)}</p>
          <p className="text-sm text-muted">
            {budgetFilter ? "gastos neste orçamento" : "em avulsos"}
            {!budgetFilter && inBudgets > 0 && <> · + {formatBRL(inBudgets)} em orçamentos</>}
          </p>
        </div>
        <AddButton tab="expense" label="Gasto" />
      </div>

      {budgetFilter && budgets.get(budgetFilter) && (
        <BudgetBanner budget={budgets.get(budgetFilter)!} spent={inBudgets} onClear={() => setFilter("budget", null)} />
      )}

      {usedAccounts.length > 1 && (
        <Chips<number | null>
          options={[{ value: null, label: "Todas" }, ...usedAccounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountIcon type={a.type} size={15} /> }))]}
          value={accountFilter}
          onChange={(v) => setFilter("account", v)}
        />
      )}

      {filtered.length === 0 ? (
        <Empty icon={<Receipt size={22} />} title="Nenhum gasto por aqui" text={`Nada lançado em ${monthLabel(month)}${accountFilter || budgetFilter ? " com esse filtro" : ""}.`} />
      ) : (
        [...groups.entries()].map(([date, items]) => (
          <section key={date} className="space-y-1.5">
            <div className="flex justify-between px-1 text-[13px] font-medium text-muted">
              <span>{dayLabel(date)}</span>
              <span className="num">{formatBRL(items.reduce((s, e) => s + e.amount_cents, 0))}</span>
            </div>
            <List>
              {items.map((e) => (
                <ExpenseRow
                  key={e.id}
                  expense={e}
                  account={e.account_id ? accs.get(e.account_id) : undefined}
                  budget={e.budget_id ? budgets.get(e.budget_id) : undefined}
                />
              ))}
            </List>
          </section>
        ))
      )}
    </div>
  );
}

function BudgetBanner({ budget, spent, onClear }: { budget: Recurring; spent: number; onClear: () => void }) {
  const { openSheet } = useApp();
  const rest = budget.month_amount_cents - spent;
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">{budget.description}</p>
        <button type="button" onClick={onClear} aria-label="Remover filtro" className="rounded-full p-1 text-muted hover:bg-surface-2">
          <X size={16} />
        </button>
      </div>
      <Progress value={spent} max={budget.month_amount_cents} className="mt-2" />
      <div className="mt-2 flex items-center justify-between text-sm">
        <span className={cx("font-semibold", rest < 0 && "text-danger")}>{rest >= 0 ? `Restam ${formatBRL(rest)}` : `Estourou ${formatBRL(-rest)}`}</span>
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "new", tab: "expense", budgetId: budget.id })}>
          <Plus size={16} /> Lançar aqui
        </Button>
      </div>
    </div>
  );
}

function InstallmentList() {
  const { month, openSheet } = useApp();
  const [all, setAll] = useState(false);
  const list = useData<Installment[]>(`/api/installments?month=${month}${all ? "&all=1" : ""}`).data;
  const accs = accountMap(useAccounts());
  if (!list) return <ListSkeleton />;
  const active = list.filter((i) => i.current >= 1 && i.current <= i.total_installments);
  const total = active.reduce((s, i) => s + i.installment_cents, 0);
  const debt = list.reduce((s, i) => s + i.remaining_cents + (i.current >= 1 && i.current <= i.total_installments ? i.installment_cents : 0), 0);
  const endingNow = active.filter((i) => i.current === i.total_installments).reduce((s, i) => s + i.installment_cents, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="num text-2xl font-bold">{formatBRL(total)}</p>
          <p className="text-sm text-muted">
            no mês · saldo a pagar <span className="num">{formatBRL(debt)}</span>
          </p>
        </div>
        <AddButton tab="installment" label="Parcelado" />
      </div>
      {endingNow > 0 && (
        <p className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">
          🎉 <b className="num">{formatBRL(endingNow)}</b> em parcelas terminam neste mês.
        </p>
      )}
      <Chips<"active" | "all">
        options={[
          { value: "active", label: "Deste mês" },
          { value: "all", label: "Todos" },
        ]}
        value={all ? "all" : "active"}
        onChange={(v) => setAll(v === "all")}
      />
      {list.length === 0 ? (
        <Empty icon={<Layers size={22} />} title="Nenhum parcelado" text="Cadastre compras parceladas para ver quanto falta e quando terminam." />
      ) : (
        <List>
          {list.map((i) => {
            const status =
              i.current < 1 ? `começa em ${monthLabel(i.first_month, true)}` : i.current > i.total_installments ? "finalizado" : `${i.current}/${i.total_installments}`;
            const acc = i.account_id ? accs.get(i.account_id) : undefined;
            return (
              <Row
                key={i.id}
                left={<InstallmentRing current={Math.min(Math.max(i.current, 0), i.total_installments)} total={i.total_installments} />}
                title={i.description}
                subtitle={
                  <>
                    <span className="num font-medium text-text">{status}</span>
                    {i.current <= i.total_installments && <span>até {monthLabel(i.last_month, true)}</span>}
                    {acc && <span>{acc.name}</span>}
                  </>
                }
                right={
                  <>
                    <Money cents={i.installment_cents} className={cx("block font-semibold", (i.current < 1 || i.current > i.total_installments) && "text-muted")} />
                    {i.remaining_cents > 0 && <span className="num block text-xs text-muted">falta {formatBRL(i.remaining_cents)}</span>}
                  </>
                }
                onClick={() => openSheet({ kind: "installment", item: i })}
              />
            );
          })}
        </List>
      )}
    </div>
  );
}

function InstallmentRing({ current, total }: { current: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const pct = total ? current / total : 0;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" className="shrink-0" aria-hidden>
      <circle cx="19" cy="19" r={r} fill="none" strokeWidth="4" className="stroke-surface-2" />
      <circle
        cx="19"
        cy="19"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 19 19)"
        className={pct >= 1 ? "stroke-success" : "stroke-accent"}
      />
    </svg>
  );
}

function RecurringList() {
  const { month, openSheet } = useApp();
  const list = useData<Recurring[]>(`/api/recurring?month=${month}`).data;
  const accs = accountMap(useAccounts());
  const { run } = useMutation();
  if (!list) return <ListSkeleton />;
  const fixed = list.filter((r) => !r.is_budget);
  const budgets = list.filter((r) => r.is_budget);
  const total = fixed.reduce((s, r) => s + r.month_amount_cents, 0) + budgets.reduce((s, r) => s + Math.max(r.month_amount_cents, r.spent_cents), 0);
  const paid = fixed.filter((r) => r.paid).reduce((s, r) => s + r.month_amount_cents, 0);
  const fixedTotal = fixed.reduce((s, r) => s + r.month_amount_cents, 0);

  const togglePaid = (r: Recurring) =>
    run(() => api.put(`/api/recurring/${r.id}/months/${month}`, { paid: !r.paid }), r.paid ? undefined : `${r.description} pago ✓`);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="num text-2xl font-bold">{formatBRL(total)}</p>
          <p className="text-sm text-muted">
            pagos <span className="num">{formatBRL(paid)}</span> de <span className="num">{formatBRL(fixedTotal)}</span> em contas
          </p>
        </div>
        <AddButton tab="recurring" label="Fixo" />
      </div>
      {list.length === 0 && <Empty icon={<Repeat size={22} />} title="Nenhum fixo" text="Assinaturas, contas e orçamentos mensais aparecem aqui todo mês." />}
      {fixed.length > 0 && (
        <Section title="Contas e assinaturas">
          <List>
            {fixed.map((r) => {
              const acc = r.account_id ? accs.get(r.account_id) : undefined;
              return (
                <Row
                  key={r.id}
                  left={<CheckCircle checked={r.paid} onClick={() => togglePaid(r)} label={r.paid ? `Desmarcar ${r.description}` : `Marcar ${r.description} como pago`} />}
                  title={r.description}
                  subtitle={
                    <>
                      {acc && <span>{acc.name}</span>}
                      {r.day && <span>dia {r.day}</span>}
                      {r.overridden && <Badge tone="warn">ajustado no mês</Badge>}
                      {r.end_month === month && <Badge tone="danger">último mês</Badge>}
                    </>
                  }
                  right={<Money cents={r.month_amount_cents} className={cx("font-semibold", r.paid && "text-muted")} />}
                  onClick={() => openSheet({ kind: "recurring", item: r })}
                />
              );
            })}
          </List>
        </Section>
      )}
      {budgets.length > 0 && (
        <Section title="Orçamentos">
          <List>
            {budgets.map((r) => (
              <Row
                key={r.id}
                title={r.description}
                subtitle={
                  <span className="w-full">
                    <Progress value={r.spent_cents} max={r.month_amount_cents} className="mt-1" />
                    <span className="num mt-1 block">
                      {formatBRL(r.spent_cents)} gastos · {r.month_amount_cents - r.spent_cents >= 0 ? `restam ${formatBRL(r.month_amount_cents - r.spent_cents)}` : `estourou ${formatBRL(r.spent_cents - r.month_amount_cents)}`}
                    </span>
                  </span>
                }
                right={<Money cents={r.month_amount_cents} className="font-semibold" />}
                onClick={() => openSheet({ kind: "recurring", item: r })}
              />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-2xl bg-surface" />
      ))}
    </div>
  );
}
