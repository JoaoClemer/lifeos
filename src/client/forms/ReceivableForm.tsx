import { useState } from "react";
import { formatBRL } from "../../shared/money";
import { addMonths, formatDateBR, monthLabel, referenceMonth } from "../../shared/month";
import type { Receivable } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Button, Field, inputCls, MoneyInput, Segmented, TextInput, Toggle } from "../ui";
import { AccountChips, confirmDelete, FormFooter, NumberInput, useAccounts } from "./common";

export function ReceivableForm({ item, person: presetPerson, onDone }: { item?: Receivable; person?: string; onDone: () => void }) {
  const { today, month: viewMonth } = useApp();
  const people = useData<string[]>("/api/people").data ?? [];
  const accounts = useAccounts();
  const { run, busy } = useMutation();

  const [person, setPerson] = useState(item?.person ?? presetPerson ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState<number | null>(item?.amount_cents ?? null);
  const [accountId, setAccountId] = useState<number | null>(item?.account_id ?? null);
  const [date, setDate] = useState(item?.date ?? today);
  const [received, setReceived] = useState(!!item?.received_at);
  // Devedor parcelado (só na criação)
  const [split, setSplit] = useState(false);
  const [mode, setMode] = useState<"parcela" | "total">("parcela");
  const [count, setCount] = useState(2);
  const [started, setStarted] = useState(false);
  const [current, setCurrent] = useState(1);

  const installments = !item && split ? count : 1;
  const perInstallment = amount == null ? 0 : mode === "total" && installments > 1 ? Math.round(amount / installments) : amount;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const firstMonth = started ? addMonths(viewMonth, -(current - 1)) : referenceMonth(date, account);
  const valid = !!amount && person.trim() && description.trim() && (!split || !started || current <= count);

  async function save() {
    if (!valid) return;
    const body = { person, description, amount_cents: amount, account_id: accountId, date };
    if (item) {
      const ok = await run(
        () => api.patch(`/api/receivables/${item.id}`, { ...body, received_at: received ? (item.received_at ?? today) : null }),
        "Atualizado",
      );
      if (ok) onDone();
      return;
    }
    const payload =
      installments > 1
        ? {
            ...body,
            installments,
            ...(mode === "total" ? { amount_cents: undefined, total_cents: amount } : {}),
            ...(started ? { current_installment: current, month: viewMonth } : {}),
          }
        : body;
    const msg = installments > 1 ? `${person.trim()} te deve ${installments}x ${formatBRL(perInstallment)} — anotado!` : `${person.trim()} te deve — anotado!`;
    if (await run(() => api.post("/api/receivables", payload), msg)) onDone();
  }

  async function remove() {
    if (!item) return;
    const what = item.installment_no ? `a parcela ${item.installment_no}/${item.installment_total} de "${item.description}"` : `"${item.description}" de ${item.person}`;
    if (!confirmDelete(what)) return;
    if (await run(() => api.del(`/api/receivables/${item.id}`), "Excluído")) onDone();
  }

  async function removeGroup() {
    if (!item) return;
    if (!window.confirm(`Excluir todas as parcelas ainda não recebidas de "${item.description}" (${item.person})? As já recebidas ficam no histórico.`)) return;
    if (await run(() => api.del(`/api/receivables/${item.id}?group=1`), "Parcelamento excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Quem te deve" htmlFor="rcv-person">
        <datalist id="rcv-people">
          {people.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <TextInput id="rcv-person" list="rcv-people" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Nome" autoFocus={!item && !presetPerson} />
      </Field>
      {people.length > 0 && !item && (
        <div className="-mt-2 flex flex-wrap gap-1.5">
          {people.slice(0, 6).map((p) => (
            <button key={p} type="button" onClick={() => setPerson(p)} className="rounded-full bg-surface-2 px-3 py-1 text-sm hover:bg-border">
              {p}
            </button>
          ))}
        </div>
      )}
      <Field label="Descrição" htmlFor="rcv-desc">
        <TextInput id="rcv-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Passagem, Mercado, Celular" />
      </Field>

      {item && !item.received_at && item.disputed_at && (
        <div className="space-y-2 rounded-xl bg-danger-soft p-3 text-sm">
          <p className="font-semibold text-danger">{item.person} contestou este item</p>
          <p className="text-text">“{item.dispute_note}”</p>
          <Button
            variant="secondary"
            className="h-9 px-3 text-sm"
            disabled={busy}
            onClick={async () => (await run(() => api.post(`/api/receivables/${item.id}/resolve-dispute`), "Contestação resolvida")) && onDone()}
          >
            Marcar como resolvida
          </Button>
        </div>
      )}
      {item && !item.received_at && item.paid_claimed_at && (
        <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">
          {item.person} disse que pagou em {formatDateBR(item.paid_claimed_at)}. Confira e marque como recebido.
        </p>
      )}

      {item?.installment_no && (
        <p className="rounded-xl bg-surface-2 p-3 text-sm text-muted">
          Parcela <b className="text-text">{item.installment_no} de {item.installment_total}</b> · fatura de {monthLabel(item.month)}. Alterações valem só para esta parcela.
        </p>
      )}

      {!item && (
        <div className="space-y-3 rounded-2xl border border-border p-3">
          <Toggle checked={split} onChange={setSplit} label="Parcelado no cartão" description="Cada parcela entra na fatura do seu mês" />
          {split && (
            <>
              <Segmented
                options={[
                  { value: "parcela", label: "Valor da parcela" },
                  { value: "total", label: "Valor total" },
                ]}
                value={mode}
                onChange={setMode}
              />
              <Field label="Parcelas" htmlFor="rcv-count">
                <NumberInput id="rcv-count" value={count} onChange={setCount} min={2} />
              </Field>
              <Toggle checked={started} onChange={setStarted} label="Já está pagando" description="Para parcelamentos em andamento" />
              {started && (
                <Field label={`Parcela que cai em ${monthLabel(viewMonth)}`} htmlFor="rcv-current">
                  <NumberInput id="rcv-current" value={current} onChange={setCurrent} max={count} />
                </Field>
              )}
            </>
          )}
        </div>
      )}

      <Field label={installments > 1 ? (mode === "total" ? "Valor total" : "Valor da parcela") : "Valor"} htmlFor="rcv-amount">
        <MoneyInput id="rcv-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="Passou em qual cartão/conta?" hint="Se passou no seu cartão, o valor entra na fatura dele.">
        <AccountChips value={accountId} onChange={setAccountId} noneLabel="Não passou" />
      </Field>
      <Field label={installments > 1 ? "Data da compra" : "Data"} htmlFor="rcv-date">
        <input id="rcv-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
      </Field>

      {installments > 1 && perInstallment > 0 && (
        <div className="rounded-xl bg-accent-soft p-3 text-sm text-accent">
          <b className="num">
            {installments}x de {formatBRL(perInstallment)}
          </b>{" "}
          = <span className="num">{formatBRL(perInstallment * installments)}</span> · de {monthLabel(firstMonth, true)} a{" "}
          {monthLabel(addMonths(firstMonth, installments - 1), true)}
          {started && current > 1 && <span> · a partir da parcela {current}</span>}
        </div>
      )}

      {item && <Toggle checked={received} onChange={setReceived} label="Já recebi" />}
      {item?.installment_group && (
        <Button variant="danger" className="w-full" onClick={removeGroup}>
          Excluir todas as parcelas pendentes
        </Button>
      )}
      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Registrar"} />
    </div>
  );
}
