import { useState } from "react";
import { formatBRL } from "../../shared/money";
import { addMonths, monthLabel } from "../../shared/month";
import type { MonthBalance } from "../../shared/types";
import { api } from "../api";
import { useMutation } from "../state";
import { Button, Field, MoneyInput, Segmented, TextInput } from "../ui";
import { FormFooter } from "./common";

/** Ajuste manual do saldo inicial de um mês (= saldo final do mês anterior). */
export function BalanceForm({ month, balance, onDone }: { month: string; balance: MonthBalance; onDone: () => void }) {
  const { run, busy } = useMutation();
  const [negative, setNegative] = useState(balance.opening_cents < 0);
  const [amount, setAmount] = useState<number | null>(Math.abs(balance.opening_cents));
  const [note, setNote] = useState(balance.note ?? "");
  const prev = monthLabel(addMonths(month, -1)).split(" de ")[0];
  const isManual = balance.opening_source === "manual";

  async function save() {
    if (amount == null) return;
    const ok = await run(
      () => api.put(`/api/balances/${month}`, { opening_cents: negative ? -amount : amount, note: note || null }),
      "Saldo ajustado",
    );
    if (ok) onDone();
  }

  async function reset() {
    if (await run(() => api.del(`/api/balances/${month}`), "Voltou ao saldo automático")) onDone();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        É o saldo com que você começa {monthLabel(month)}, ou seja, o saldo final de {prev}. Se conferiu o banco e o valor real é outro, ajuste aqui: os meses
        seguintes continuam a partir dele.
      </p>
      <div className="rounded-xl bg-surface-2 p-3 text-sm">
        <span className="text-muted">Valor automático: </span>
        <b className="num">{formatBRL(balance.automatic_opening_cents)}</b>
        <span className="text-muted">
          {balance.opening_source === "start" || (isManual && month === balance.start_month)
            ? " (início do saldo acumulado)"
            : ` (sobra acumulada até ${prev})`}
        </span>
      </div>
      <Segmented
        options={[
          { value: "pos", label: "Positivo" },
          { value: "neg", label: "Negativo" },
        ]}
        value={negative ? "neg" : "pos"}
        onChange={(v) => setNegative(v === "neg")}
      />
      <Field label={`Saldo real no início de ${monthLabel(month)}`} htmlFor="bal-amount">
        <MoneyInput id="bal-amount" value={amount} onChange={setAmount} big />
      </Field>
      <Field label="Observação (opcional)" htmlFor="bal-note">
        <TextInput id="bal-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: conferi no banco" />
      </Field>
      {isManual && (
        <Button variant="secondary" className="w-full" onClick={reset} disabled={busy}>
          Usar o valor automático ({formatBRL(balance.automatic_opening_cents)})
        </Button>
      )}
      <FormFooter onSave={save} busy={busy} disabled={amount == null} saveLabel="Salvar saldo" />
    </div>
  );
}
