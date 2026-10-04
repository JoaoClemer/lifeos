import { useState } from "react";
import type { Receivable } from "../../shared/types";
import { api } from "../api";
import { useApp, useData, useMutation } from "../state";
import { Field, inputCls, MoneyInput, TextInput, Toggle } from "../ui";
import { AccountChips, confirmDelete, FormFooter } from "./common";

export function ReceivableForm({ item, person: presetPerson, onDone }: { item?: Receivable; person?: string; onDone: () => void }) {
  const { today } = useApp();
  const people = useData<string[]>("/api/people").data ?? [];
  const { run, busy } = useMutation();

  const [person, setPerson] = useState(item?.person ?? presetPerson ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [amount, setAmount] = useState<number | null>(item?.amount_cents ?? null);
  const [accountId, setAccountId] = useState<number | null>(item?.account_id ?? null);
  const [date, setDate] = useState(item?.date ?? today);
  const [received, setReceived] = useState(!!item?.received_at);

  const valid = !!amount && person.trim() && description.trim();

  async function save() {
    if (!valid) return;
    const body = { person, description, amount_cents: amount, account_id: accountId, date };
    const ok = item
      ? await run(
          () =>
            api.patch(`/api/receivables/${item.id}`, {
              ...body,
              received_at: received ? (item.received_at ?? today) : null,
            }),
          "Atualizado",
        )
      : await run(() => api.post("/api/receivables", body), `${person.trim()} te deve — anotado!`);
    if (ok) onDone();
  }

  async function remove() {
    if (!item || !confirmDelete(`"${item.description}" de ${item.person}`)) return;
    if (await run(() => api.del(`/api/receivables/${item.id}`), "Excluído")) onDone();
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
        <TextInput id="rcv-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Passagem, Mercado, Ingresso" />
      </Field>
      <Field label="Valor" htmlFor="rcv-amount">
        <MoneyInput id="rcv-amount" value={amount} onChange={setAmount} />
      </Field>
      <Field label="Passou em qual cartão/conta?" hint="Se passou no seu cartão, o valor entra na fatura dele.">
        <AccountChips value={accountId} onChange={setAccountId} noneLabel="Não passou" />
      </Field>
      <Field label="Data" htmlFor="rcv-date">
        <input id="rcv-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className={inputCls} />
      </Field>
      {item && <Toggle checked={received} onChange={setReceived} label="Já recebi" />}
      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Registrar"} />
    </div>
  );
}
