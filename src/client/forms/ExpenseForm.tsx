import { useEffect, useMemo, useRef, useState } from "react";
import { formatBRL } from "../../shared/money";
import { monthLabel, referenceMonth } from "../../shared/month";
import type { Expense, Recurring } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Chips, Field, inputCls, LinkButton, MonthStepper, MoneyInput, TextInput } from "../ui";
import { AccountChips, confirmDelete, FormFooter, useAccounts, useSettings } from "./common";
import { computeSplits, EMPTY_SPLIT, SplitFields, type SplitRow } from "./SplitFields";

export function ExpenseForm({ item, budgetId, onDone }: { item?: Expense; budgetId?: number; onDone: () => void }) {
  const { today, month: viewMonth } = useApp();
  const accounts = useAccounts();
  const settings = useSettings();
  const budgets = (useData<Recurring[]>(`/api/recurring?month=${item?.month ?? viewMonth}`).data ?? []).filter((r) => r.is_budget);
  const { run, busy } = useMutation();

  const [amount, setAmount] = useState<number | null>(item?.amount_cents ?? null);
  const [description, setDescription] = useState(item?.description ?? "");
  const [accountId, setAccountId] = useState<number | null>(item?.account_id ?? null);
  const accountTouched = useRef(!!item);
  const [date, setDate] = useState(item?.date ?? today);
  const [budget, setBudget] = useState<number | null>(item?.budget_id ?? budgetId ?? null);
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [monthOverride, setMonthOverride] = useState<string | null>(null);
  const [splitOn, setSplitOn] = useState(false);
  const [rows, setRows] = useState<SplitRow[]>(EMPTY_SPLIT);

  // Conta padrão (ou a última usada no orçamento escolhido, ex.: VR para almoço)
  useEffect(() => {
    if (accountTouched.current) return;
    if (budget) {
      api.get<Expense[]>(`/api/expenses?budget_id=${budget}&limit=1`).then((list) => {
        if (!accountTouched.current && list[0]?.account_id) setAccountId(list[0].account_id);
      });
    } else if (settings?.default_account_id) setAccountId(settings.default_account_id);
    else if (accounts[0]) setAccountId(accounts[0].id);
  }, [budget, settings, accounts]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const autoMonth = referenceMonth(date, account);
  const month = monthOverride ?? autoMonth;
  const split = useMemo(() => computeSplits(amount ?? 0, splitOn ? rows : []), [amount, rows, splitOn]);
  const valid = !!amount && description.trim() && (!splitOn || split.mine >= 0);

  async function save() {
    if (!valid) return;
    if (item) {
      const ok = await run(
        () =>
          api.patch(`/api/expenses/${item.id}`, {
            description,
            amount_cents: amount,
            date,
            account_id: accountId,
            budget_id: budget,
            notes: notes || null,
            ...(monthOverride ? { month: monthOverride } : {}),
          }),
        "Lançamento atualizado",
      );
      if (ok) onDone();
    } else {
      const ok = await run(
        () =>
          api.post("/api/expenses", {
            description,
            amount_cents: amount,
            date,
            account_id: accountId,
            budget_id: budget,
            notes: notes || null,
            ...(monthOverride ? { month: monthOverride } : {}),
            ...(split.splits.length ? { splits: split.splits } : {}),
          }),
        split.splits.length === 1
          ? `Lançado! ${split.splits[0].person} te deve ${formatBRL(split.splits[0].amount_cents)}`
          : split.splits.length > 1
            ? `Lançado! ${split.splits.map((s) => s.person).join(" e ")} te devem`
            : "Lançado!",
      );
      if (ok) onDone();
    }
  }

  async function remove() {
    if (!item || !confirmDelete(`"${item.description}"`)) return;
    const ok = await run(() => api.del(`/api/expenses/${item.id}`), "Lançamento excluído");
    if (ok) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label={item?.shared_cents ? "Valor (sua parte)" : "Valor"} htmlFor="exp-amount">
        <MoneyInput id="exp-amount" value={amount} onChange={setAmount} big autoFocus={!item} />
      </Field>
      <Field label="Descrição" htmlFor="exp-desc">
        <TextInput id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Mercado, Almoço, Uber" />
      </Field>
      <Field label="Cartão / conta">
        <AccountChips
          value={accountId}
          onChange={(id) => {
            accountTouched.current = true;
            setAccountId(id);
          }}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" htmlFor="exp-date">
          <input id="exp-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Entra no mês">
          {monthOverride === null ? (
            <div className="flex h-11 items-center justify-between rounded-xl px-1">
              <span className="text-[15px] font-medium">{monthLabel(autoMonth, true)}</span>
              <LinkButton onClick={() => setMonthOverride(autoMonth)}>alterar</LinkButton>
            </div>
          ) : (
            <MonthStepper value={month} onChange={(m) => setMonthOverride(m)} fallback={autoMonth} />
          )}
        </Field>
      </div>
      {budgets.length > 0 && (
        <Field label="Descontar de um orçamento?" hint={budget ? "Este gasto sai do valor reservado e não soma de novo no total do mês." : undefined}>
          <Chips<number | null> options={[{ value: null, label: "Não" }, ...budgets.map((b) => ({ value: b.id, label: b.description }))]} value={budget} onChange={setBudget} />
        </Field>
      )}

      {!item && <SplitFields on={splitOn} onToggle={setSplitOn} rows={rows} onRows={setRows} total={amount} split={split} />}
      {item && item.shared_cents > 0 && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
          Este gasto foi dividido: <b className="num text-text">{formatBRL(item.shared_cents)}</b> estão em Devedores.
        </p>
      )}

      <Field label="Observação (opcional)" htmlFor="exp-notes">
        <TextInput id="exp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <FormFooter onSave={save} saveLabel={item ? "Salvar" : "Lançar"} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} />
    </div>
  );
}
