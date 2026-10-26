import { ArrowDownLeft, ArrowUpRight, LogOut, Pencil, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { PeoplePicker } from "../PeoplePicker";
import { formatBRL } from "../../shared/money";
import { formatDateBR, monthLabel } from "../../shared/month";
import type { Goal, GoalEntry } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Button, cx, Field, inputCls, MonthStepper, MoneyInput, Progress, Segmented, TextInput } from "../ui";
import { confirmDelete, FormFooter } from "./common";

export function GoalForm({ item, onDone }: { item?: Goal; onDone: () => void }) {
  const { month } = useApp();
  const { run, busy } = useMutation();
  const [name, setName] = useState(item?.name ?? "");
  const [institution, setInstitution] = useState(item?.institution ?? "");
  const [initial, setInitial] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(item?.target_cents ?? null);
  const [monthly, setMonthly] = useState<number | null>(item?.monthly_cents ?? null);
  const [deadline, setDeadline] = useState<string | null>(item?.deadline ?? null);
  // Meta em conjunto: pessoas conectadas que juntam dinheiro com você (cada uma define o próprio aporte)
  const originalPeople = (item?.members ?? []).filter((m) => m.role === "member").map((m) => m.id);
  const [people, setPeople] = useState<number[]>(originalPeople);

  const remaining = target != null ? Math.max(target - (item?.balance_cents ?? initial ?? 0), 0) : null;

  async function save() {
    if (!name.trim()) return;
    const body = {
      name,
      institution: institution || null,
      target_cents: target || null,
      monthly_cents: monthly || null,
      deadline,
    };
    const ok = await run(async () => {
      const g = item ? await api.patch<Goal>(`/api/goals/${item.id}`, body) : await api.post<Goal>("/api/goals", { ...body, initial_cents: initial ?? 0 });
      if (JSON.stringify([...people].sort()) !== JSON.stringify([...originalPeople].sort())) await api.put(`/api/goals/${g.id}/members`, { user_ids: people });
      return g;
    }, item ? "Meta atualizada" : "Meta criada");
    if (ok) onDone();
  }

  async function remove() {
    if (!item || !confirmDelete(`a meta "${item.name}" e todo o histórico`)) return;
    if (await run(() => api.del(`/api/goals/${item.id}`), "Meta excluída")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Nome" htmlFor="goal-name">
        <TextInput id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reserva de emergência, Viagem" autoFocus={!item} />
      </Field>
      <Field label="Onde está investido (opcional)" htmlFor="goal-inst">
        <TextInput id="goal-inst" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Ex.: Tesouro Selic, CDB Nubank" />
      </Field>
      {!item && (
        <Field label="Quanto você já tem" htmlFor="goal-initial">
          <MoneyInput id="goal-initial" value={initial} onChange={setInitial} />
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Meta (opcional)" htmlFor="goal-target">
          <MoneyInput id="goal-target" value={target} onChange={setTarget} />
        </Field>
        <Field label="Aporte mensal" htmlFor="goal-monthly">
          <MoneyInput id="goal-monthly" value={monthly} onChange={setMonthly} />
        </Field>
      </div>
      <Field label="Prazo (opcional)">
        <MonthStepper value={deadline} onChange={setDeadline} allowClear placeholder="Sem prazo" fallback={month} />
      </Field>
      {remaining != null && remaining > 0 && (monthly || deadline) && (
        <div className="rounded-xl bg-accent-soft p-3 text-sm text-accent">
          {monthly ? (
            <p>
              Com <b className="num">{formatBRL(monthly)}</b>/mês você chega lá em <b>{Math.ceil(remaining / monthly)} meses</b>.
            </p>
          ) : null}
          {deadline ? (
            <p>
              Para bater até {monthLabel(deadline)}: <b className="num">{formatBRL(Math.ceil(remaining / Math.max(monthsUntil(month, deadline), 1)))}</b>/mês.
            </p>
          ) : null}
        </div>
      )}
      <Field label="Em conjunto com" hint="O saldo é de todos; cada pessoa define o próprio aporte mensal e, no resumo dela, entram só os aportes dela.">
        <PeoplePicker value={people} onChange={setPeople} />
      </Field>

      <FormFooter onSave={save} busy={busy} disabled={!name.trim()} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Criar meta"} />
    </div>
  );
}

function monthsUntil(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ty * 12 + tm - (fy * 12 + fm) + 1;
}

const ENTRY_LABEL: Record<GoalEntry["kind"], string> = { contribution: "Aporte", withdrawal: "Resgate", adjustment: "Ajuste / rendimento" };

export function GoalDetail({ id, onEdit }: { id: number; onEdit: (g: Goal) => void }) {
  const { month, today } = useApp();
  const goal = useData<Goal[]>(`/api/goals?month=${month}`).data?.find((g) => g.id === id);
  const entries = useData<GoalEntry[]>(`/api/goals/${id}/entries`).data ?? [];
  const { run, busy } = useMutation();
  const [action, setAction] = useState<"contribution" | "withdrawal" | "balance">("contribution");
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [plan, setPlan] = useState<number | null | undefined>(undefined);

  if (!goal) return <p className="py-8 text-center text-muted">Carregando…</p>;
  const myPlan = plan === undefined ? goal.monthly_cents : plan;

  // Sem valor digitado, o aporte usa o valor mensal planejado
  const value = amount ?? (action === "contribution" ? goal.monthly_cents : null);

  async function submit() {
    if (value == null || !goal) return;
    const ok =
      action === "balance"
        ? await run(() => api.post(`/api/goals/${goal.id}/balance`, { balance_cents: value }), "Saldo atualizado")
        : await run(
            () => api.post(`/api/goals/${goal.id}/entries`, { kind: action, amount_cents: value, date }),
            action === "contribution" ? "Aporte registrado" : "Resgate registrado",
          );
    if (ok) setAmount(null);
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="num text-3xl font-bold">{formatBRL(goal.balance_cents)}</p>
            {goal.institution && <p className="text-sm text-muted">{goal.institution}</p>}
          </div>
          {!goal.owner && (
            <Button variant="secondary" onClick={() => onEdit(goal)} className="h-9 px-3 text-sm">
              <Pencil size={15} /> Editar
            </Button>
          )}
        </div>
        {goal.target_cents ? (
          <>
            <Progress value={goal.balance_cents} max={goal.target_cents} goal />
            <p className="text-sm text-muted">
              {Math.floor((goal.balance_cents / goal.target_cents) * 100)}% de <span className="num">{formatBRL(goal.target_cents)}</span>
              {goal.eta_month && ` · previsão ${monthLabel(goal.eta_month, true)}`}
              {goal.required_monthly_cents ? ` · precisa de ${formatBRL(goal.required_monthly_cents)}/mês até ${monthLabel(goal.deadline!, true)}` : ""}
            </p>
          </>
        ) : null}
      </div>

      {goal.members.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">{goal.owner ? `Meta de ${goal.owner.name ?? "pessoa conectada"}, em conjunto` : "Em conjunto"}</p>
          <ul className="space-y-1 text-sm">
            {goal.members.map((m) => (
              <li key={m.id} className="flex justify-between gap-3">
                <span>{m.name ?? "Pessoa"}</span>
                <span className="num text-muted">
                  {formatBRL(m.month_contrib_cents)} no mês{m.monthly_cents ? ` de ${formatBRL(m.monthly_cents)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {goal.owner && (
            <div className="space-y-2 border-t border-border pt-2">
              <Field label="Seu aporte mensal">
                <div className="flex gap-2">
                  <MoneyInput value={myPlan} onChange={setPlan} />
                  <Button
                    variant="secondary"
                    className="shrink-0"
                    disabled={busy || myPlan === goal.monthly_cents}
                    onClick={async () => (await run(() => api.put(`/api/goals/${goal.id}/my-plan`, { monthly_cents: myPlan || null }), "Aporte mensal salvo")) && setPlan(undefined)}
                  >
                    Salvar
                  </Button>
                </div>
              </Field>
              <Button
                variant="ghost"
                className="h-8 px-2 text-sm text-danger"
                disabled={busy}
                onClick={() =>
                  window.confirm(`Sair da meta "${goal.name}"? Seus aportes continuam no saldo dela.`) && run(() => api.post(`/api/goals/${goal.id}/leave`), "Você saiu da meta")
                }
              >
                <LogOut size={15} /> Sair da meta
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 rounded-2xl border border-border p-3">
        <Segmented
          options={[
            { value: "contribution", label: "Aportar" },
            { value: "withdrawal", label: "Resgatar" },
            { value: "balance", label: "Novo saldo" },
          ]}
          value={action}
          onChange={setAction}
        />
        {action === "balance" && <p className="text-xs text-muted">Informe o saldo atual (com rendimentos). A diferença fica registrada como ajuste.</p>}
        <div className={cx("grid gap-3", action !== "balance" && "grid-cols-[1fr_auto]")}>
          <MoneyInput value={amount} onChange={setAmount} placeholder={action === "contribution" && goal.monthly_cents ? formatBRL(goal.monthly_cents).replace("R$", "").trim() : "0,00"} />
          {action !== "balance" && (
            <input type="date" aria-label="Data" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls + " w-40"} />
          )}
        </div>
        <Button className="w-full" onClick={submit} disabled={value == null || busy}>
          {action === "contribution" ? "Registrar aporte" : action === "withdrawal" ? "Registrar resgate" : "Atualizar saldo"}
        </Button>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Histórico</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2.5">
                <span className={cx("rounded-full p-1.5", e.amount_cents >= 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                  {e.kind === "adjustment" ? <RefreshCw size={14} /> : e.amount_cents >= 0 ? <ArrowDownLeft size={14} /> : <ArrowUpRight size={14} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{e.note || ENTRY_LABEL[e.kind]}</p>
                  <p className="text-xs text-muted">
                    {formatDateBR(e.date)}
                    {e.author && ` · por ${e.author}`}
                  </p>
                </div>
                <span className={cx("num text-sm font-semibold", e.amount_cents >= 0 ? "text-success" : "text-danger")}>
                  {e.amount_cents >= 0 ? "+" : "−"}
                  {formatBRL(Math.abs(e.amount_cents))}
                </span>
                {e.mine ? (
                  <button
                    type="button"
                    aria-label="Excluir movimentação"
                    className="p-1 text-muted hover:text-danger"
                    onClick={() => confirmDelete("esta movimentação") && run(() => api.del(`/api/goal-entries/${e.id}`), "Movimentação excluída")}
                  >
                    <X size={16} />
                  </button>
                ) : (
                  <span className="w-6" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
