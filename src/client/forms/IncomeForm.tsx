import { useState } from "react";
import { monthLabel, monthOf } from "../../shared/month";
import type { Income } from "../../shared/types";
import { api } from "../api";
import { useApp, useMutation } from "../state";
import { Field, inputCls, LinkButton, MonthStepper, MoneyInput, TextInput } from "../ui";
import { confirmDelete, FormFooter } from "./common";

const SUGGESTIONS = ["13º salário", "Bônus", "PLR", "Férias", "Freela", "Reembolso"];

export function IncomeForm({ item, onDone }: { item?: Income; onDone: () => void }) {
  const { today } = useApp();
  const { run, busy } = useMutation();
  const [amount, setAmount] = useState<number | null>(item?.amount_cents ?? null);
  const [description, setDescription] = useState(item?.description ?? "");
  const [date, setDate] = useState(item?.date ?? today);
  // Mês em que a entrada conta: acompanha a data, a menos que seja alterado (ex.: 13º pago em dezembro para o mês de janeiro)
  const [monthOverride, setMonthOverride] = useState<string | null>(item && item.month !== monthOf(item.date) ? item.month : null);
  const [notes, setNotes] = useState(item?.notes ?? "");

  const month = monthOverride ?? monthOf(date);
  const valid = !!amount && description.trim();

  async function save() {
    if (!valid) return;
    const body = { description, amount_cents: amount, date, month, notes: notes || null };
    const ok = item
      ? await run(() => api.patch(`/api/incomes/${item.id}`, body), "Entrada atualizada")
      : await run(() => api.post("/api/incomes", body), "Entrada registrada!");
    if (ok) onDone();
  }

  async function remove() {
    if (!item || !confirmDelete(`a entrada "${item.description}"`)) return;
    if (await run(() => api.del(`/api/incomes/${item.id}`), "Entrada excluída")) onDone();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Dinheiro além do salário fixo: 13º, bônus, PLR, freela… Soma na renda do mês.</p>
      <Field label="Valor" htmlFor="inc-amount">
        <MoneyInput id="inc-amount" value={amount} onChange={setAmount} big autoFocus={!item} />
      </Field>
      <Field label="Descrição" htmlFor="inc-desc">
        <TextInput id="inc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: 13º salário, Bônus" />
      </Field>
      {!item && (
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setDescription(s)} className="rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-border">
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data" htmlFor="inc-date">
          <input id="inc-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Conta no mês">
          {monthOverride === null ? (
            <div className="flex h-11 items-center justify-between rounded-xl px-1">
              <span className="text-[15px] font-medium">{monthLabel(month, true)}</span>
              <LinkButton onClick={() => setMonthOverride(month)}>alterar</LinkButton>
            </div>
          ) : (
            <MonthStepper value={month} onChange={(m) => setMonthOverride(m)} fallback={month} />
          )}
        </Field>
      </div>
      <Field label="Observação (opcional)" htmlFor="inc-notes">
        <TextInput id="inc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Registrar entrada"} />
    </div>
  );
}
