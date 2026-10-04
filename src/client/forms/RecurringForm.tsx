import { useEffect, useRef, useState } from "react";
import { formatBRL } from "../../shared/money";
import { monthTitle } from "../../shared/month";
import type { Recurring } from "../../shared/types";
import { api } from "../api";
import { useApp, useMutation } from "../state";
import { Button, Field, MonthStepper, MoneyInput, Segmented, TextInput, Toggle } from "../ui";
import { AccountChips, confirmDelete, DayInput, FormFooter, useSettings } from "./common";

export function RecurringForm({ item, onDone }: { item?: Recurring; onDone: () => void }) {
  const { month } = useApp();
  const settings = useSettings();
  const { run, busy } = useMutation();

  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState<number | null>(item?.amount_cents ?? null);
  const [isBudget, setIsBudget] = useState(!!item?.is_budget);
  const [accountId, setAccountId] = useState<number | null>(item?.account_id ?? null);
  const accountTouched = useRef(!!item);
  const [day, setDay] = useState<number | null>(item?.day ?? null);
  const [startMonth, setStartMonth] = useState(item?.start_month ?? month);
  const [endMonth, setEndMonth] = useState<string | null>(item?.end_month ?? null);
  // Ajustes só deste mês
  const [monthAmount, setMonthAmount] = useState<number | null>(item?.overridden ? item.month_amount_cents : null);
  const [paid, setPaid] = useState(!!item?.paid);

  useEffect(() => {
    if (!accountTouched.current && settings?.default_account_id) setAccountId(settings.default_account_id);
  }, [settings]);

  const valid = amount != null && description.trim();

  async function save() {
    if (!valid) return;
    if (!item) {
      const ok = await run(
        () =>
          api.post("/api/recurring", {
            description,
            amount_cents: amount,
            is_budget: isBudget,
            account_id: isBudget ? null : accountId,
            day,
            start_month: startMonth,
          }),
        isBudget ? "Orçamento criado" : "Fixo cadastrado",
      );
      if (ok) onDone();
      return;
    }
    const ok = await run(async () => {
      await api.patch(`/api/recurring/${item.id}`, {
        description,
        amount_cents: amount,
        is_budget: isBudget,
        account_id: isBudget ? null : accountId,
        day,
        start_month: startMonth,
        end_month: endMonth,
      });
      const overrideChanged = (item.overridden ? item.month_amount_cents : null) !== monthAmount;
      if (overrideChanged || paid !== item.paid) {
        await api.put(`/api/recurring/${item.id}/months/${month}`, { amount_cents: monthAmount, paid });
      }
      return true;
    }, "Fixo atualizado");
    if (ok) onDone();
  }

  async function remove() {
    if (!item) return;
    if (!confirmDelete(`"${item.description}" de todos os meses (inclusive os passados)? Para cancelar uma assinatura, prefira "Encerrar"`)) return;
    if (await run(() => api.del(`/api/recurring/${item.id}`), "Fixo excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      <Segmented
        options={[
          { value: "fixed", label: "Conta / assinatura" },
          { value: "budget", label: "Orçamento" },
        ]}
        value={isBudget ? "budget" : "fixed"}
        onChange={(v) => setIsBudget(v === "budget")}
      />
      {isBudget && (
        <p className="text-sm text-muted">
          Um valor reservado por mês (ex.: R$ 500 de almoço). Você lança os gastos dentro dele e acompanha quanto falta.
        </p>
      )}
      <Field label="Descrição" htmlFor="rec-desc">
        <TextInput
          id="rec-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={isBudget ? "Ex.: Almoço trabalho, Transporte" : "Ex.: Netflix, Internet, Luz"}
          autoFocus={!item}
        />
      </Field>
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        <Field label={isBudget ? "Valor reservado por mês" : item ? "Valor padrão" : "Valor mensal"} htmlFor="rec-amount">
          <MoneyInput id="rec-amount" value={amount} onChange={setAmount} />
        </Field>
        <Field label="Dia" htmlFor="rec-day">
          <DayInput id="rec-day" value={day} onChange={setDay} />
        </Field>
      </div>
      {!isBudget && (
        <Field label="Cobrado em">
          <AccountChips
            value={accountId}
            noneLabel="Nenhum"
            onChange={(id) => {
              accountTouched.current = true;
              setAccountId(id);
            }}
          />
        </Field>
      )}

      {item && (
        <div className="space-y-3 rounded-2xl border border-border p-3">
          <p className="text-sm font-semibold">Ajustes de {monthTitle(month)}</p>
          <Field
            label="Valor só neste mês (opcional)"
            hint={monthAmount != null ? <button type="button" className="font-semibold text-accent" onClick={() => setMonthAmount(null)}>Voltar ao valor padrão</button> : "Ex.: a conta de luz deste mês veio diferente."}
          >
            <MoneyInput value={monthAmount} onChange={setMonthAmount} placeholder={amount != null ? formatBRL(amount).replace("R$", "").trim() : "0,00"} />
          </Field>
          {!isBudget && <Toggle checked={paid} onChange={setPaid} label="Pago neste mês" />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Começa em">
          <MonthStepper value={startMonth} onChange={(m) => m && setStartMonth(m)} fallback={month} />
        </Field>
        {item && (
          <Field label="Último mês">
            {endMonth ? (
              <MonthStepper value={endMonth} onChange={setEndMonth} allowClear fallback={month} />
            ) : (
              <Button variant="secondary" className="w-full" onClick={() => setEndMonth(month)}>
                Encerrar
              </Button>
            )}
          </Field>
        )}
      </div>

      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Cadastrar"} />
    </div>
  );
}
