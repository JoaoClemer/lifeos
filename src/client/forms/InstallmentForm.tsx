import { useEffect, useRef, useState } from "react";
import { formatBRL } from "../../shared/money";
import { addMonths, monthLabel, referenceMonth } from "../../shared/month";
import type { Installment } from "../../shared/types";
import { api } from "../api";
import { useApp, useMutation } from "../state";
import { Field, inputCls, MonthStepper, MoneyInput, Segmented, TextInput, Toggle } from "../ui";
import { AccountChips, confirmDelete, FormFooter, NumberInput, useAccounts, useSettings } from "./common";

export function InstallmentForm({ item, onDone }: { item?: Installment; onDone: () => void }) {
  const { today, month: viewMonth } = useApp();
  const accounts = useAccounts();
  const settings = useSettings();
  const { run, busy } = useMutation();

  const [description, setDescription] = useState(item?.description ?? "");
  const [mode, setMode] = useState<"parcela" | "total">("parcela");
  const [amount, setAmount] = useState<number | null>(item?.installment_cents ?? null);
  const [count, setCount] = useState(item?.total_installments ?? 2);
  const [accountId, setAccountId] = useState<number | null>(item?.account_id ?? null);
  const accountTouched = useRef(!!item);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(1);
  const [purchaseDate, setPurchaseDate] = useState(item?.purchase_date ?? today);
  const [firstMonth, setFirstMonth] = useState(item?.first_month ?? viewMonth);

  useEffect(() => {
    if (!accountTouched.current && settings?.default_account_id) setAccountId(settings.default_account_id);
  }, [settings]);

  const account = accounts.find((a) => a.id === accountId) ?? null;
  const perInstallment = amount == null ? 0 : mode === "total" ? Math.round(amount / count) : amount;
  const first = item ? firstMonth : started ? addMonths(viewMonth, -(current - 1)) : referenceMonth(purchaseDate, account);
  const last = addMonths(first, count - 1);
  const valid = !!amount && description.trim() && (!started || current <= count);

  async function save() {
    if (!valid) return;
    const ok = item
      ? await run(
          () =>
            api.patch(`/api/installments/${item.id}`, {
              description,
              installment_cents: perInstallment,
              total_installments: count,
              first_month: firstMonth,
              account_id: accountId,
            }),
          "Parcelado atualizado",
        )
      : await run(
          () =>
            api.post("/api/installments", {
              description,
              installment_cents: perInstallment,
              total_installments: count,
              account_id: accountId,
              ...(started ? { current_installment: current, reference_month: viewMonth } : { purchase_date: purchaseDate }),
            }),
          "Parcelado cadastrado",
        );
    if (ok) onDone();
  }

  async function remove() {
    if (!item || !confirmDelete(`"${item.description}"`)) return;
    if (await run(() => api.del(`/api/installments/${item.id}`), "Parcelado excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Descrição" htmlFor="inst-desc">
        <TextInput id="inst-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Notebook, Passagem" autoFocus={!item} />
      </Field>
      {!item && <Segmented options={[{ value: "parcela", label: "Valor da parcela" }, { value: "total", label: "Valor total" }]} value={mode} onChange={setMode} />}
      <div className="grid grid-cols-[1fr_9rem] gap-3">
        <Field label={mode === "total" && !item ? "Valor total" : "Valor da parcela"} htmlFor="inst-amount">
          <MoneyInput id="inst-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Parcelas" htmlFor="inst-count">
          <NumberInput id="inst-count" value={count} onChange={setCount} />
        </Field>
      </div>
      <Field label="Cartão">
        <AccountChips
          value={accountId}
          onChange={(id) => {
            accountTouched.current = true;
            setAccountId(id);
          }}
        />
      </Field>

      {item ? (
        <Field label="Mês da 1ª parcela">
          <MonthStepper value={firstMonth} onChange={(m) => m && setFirstMonth(m)} fallback={firstMonth} />
        </Field>
      ) : (
        <div className="space-y-3 rounded-2xl border border-border p-3">
          <Toggle checked={started} onChange={setStarted} label="Já estou pagando" description="Para cadastrar parcelamentos em andamento" />
          {started ? (
            <Field label={`Parcela que cai em ${monthLabel(viewMonth)}`} htmlFor="inst-current">
              <NumberInput id="inst-current" value={current} onChange={setCurrent} max={count} />
            </Field>
          ) : (
            <Field label="Data da compra" htmlFor="inst-date">
              <input id="inst-date" type="date" value={purchaseDate} onChange={(e) => e.target.value && setPurchaseDate(e.target.value)} className={inputCls} />
            </Field>
          )}
        </div>
      )}

      {perInstallment > 0 && (
        <div className="rounded-xl bg-accent-soft p-3 text-sm text-accent">
          <b className="num">
            {count}x de {formatBRL(perInstallment)}
          </b>{" "}
          = <span className="num">{formatBRL(perInstallment * count)}</span> · de {monthLabel(first, true)} a {monthLabel(last, true)}
        </div>
      )}

      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Cadastrar"} />
    </div>
  );
}
