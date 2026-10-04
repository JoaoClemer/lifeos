import { useState } from "react";
import { ACCOUNT_TYPE_LABEL, type Account, type AccountType } from "../../shared/types";
import { api } from "../api";
import { useMutation } from "../state";
import { AccountIcon, Chips, Field, TextInput, Toggle } from "../ui";
import { confirmDelete, DayInput, FormFooter, useSettings } from "./common";

const TYPES = Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[];

export function AccountForm({ item, onDone }: { item?: Account; onDone: () => void }) {
  const settings = useSettings();
  const { run, busy } = useMutation();
  const [name, setName] = useState(item?.name ?? "");
  const [type, setType] = useState<AccountType>(item?.type ?? "credit");
  const [closing, setClosing] = useState<number | null>(item?.closing_day ?? null);
  const [due, setDue] = useState<number | null>(item?.due_day ?? null);
  const isDefault = !!item && settings?.default_account_id === item.id;
  const [makeDefault, setMakeDefault] = useState<boolean | null>(null);

  async function save() {
    if (!name.trim()) return;
    const body = { name, type, closing_day: type === "credit" ? closing : null, due_day: type === "credit" ? due : null };
    const ok = await run(async () => {
      const acc = item ? await api.patch<Account>(`/api/accounts/${item.id}`, body) : await api.post<Account>("/api/accounts", body);
      if (makeDefault === true) await api.put("/api/settings", { default_account_id: acc.id });
      if (makeDefault === false && isDefault) await api.put("/api/settings", { default_account_id: null });
      return acc;
    }, item ? "Conta atualizada" : "Conta cadastrada");
    if (ok) onDone();
  }

  async function remove() {
    if (!item || !confirmDelete(`"${item.name}"? Se tiver lançamentos, ela será apenas arquivada`)) return;
    if (await run(() => api.del(`/api/accounts/${item.id}`), "Conta removida")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Nome" htmlFor="acc-name">
        <TextInput id="acc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Nubank, Inter, VR" autoFocus={!item} />
      </Field>
      <Field label="Tipo">
        <Chips<AccountType> wrap options={TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t], icon: <AccountIcon type={t} size={15} /> }))} value={type} onChange={setType} />
      </Field>
      {type === "credit" && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dia de fechamento" htmlFor="acc-closing">
              <DayInput id="acc-closing" value={closing} onChange={setClosing} placeholder="Ex.: 5" />
            </Field>
            <Field label="Dia de vencimento" htmlFor="acc-due">
              <DayInput id="acc-due" value={due} onChange={setDue} placeholder="Ex.: 12" />
            </Field>
          </div>
          <p className="text-xs text-muted">
            Com o fechamento, compras feitas a partir desse dia vão automaticamente para a fatura do mês seguinte.
          </p>
        </>
      )}
      <Toggle checked={makeDefault ?? isDefault} onChange={setMakeDefault} label="Conta padrão" description="Usada quando você não escolhe uma" />
      <FormFooter onSave={save} busy={busy} disabled={!name.trim()} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Cadastrar"} />
    </div>
  );
}
