import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Account, Settings } from "../../shared/types";
import { useData } from "../state";
import { AccountIcon, Button, Chips, inputCls } from "../ui";

export function useAccounts() {
  return useData<Account[]>("/api/accounts").data ?? [];
}

export function useSettings() {
  return useData<Settings>("/api/settings").data;
}

export function AccountChips({
  value,
  onChange,
  noneLabel,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  /** Se informado, mostra uma opção "nenhuma" com este rótulo. */
  noneLabel?: string;
}) {
  const accounts = useAccounts();
  const options = [
    ...(noneLabel ? [{ value: null, label: noneLabel }] : []),
    ...accounts.map((a) => ({ value: a.id, label: a.name, icon: <AccountIcon type={a.type} size={15} /> })),
  ];
  if (!accounts.length) return <p className="text-sm text-muted">Cadastre seus cartões e contas em Ajustes.</p>;
  return <Chips<number | null> options={options} value={value} onChange={onChange} />;
}

export function DayInput({ value, onChange, id, placeholder = "—" }: { value: number | null; onChange: (v: number | null) => void; id?: string; placeholder?: string }) {
  return (
    <input
      id={id}
      inputMode="numeric"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const n = Number(e.target.value.replace(/\D/g, "").slice(0, 2));
        onChange(n >= 1 && n <= 31 ? n : null);
      }}
      className={inputCls + " num"}
    />
  );
}

export function NumberInput({ value, onChange, min = 1, max = 120, id }: { value: number; onChange: (v: number) => void; min?: number; max?: number; id?: string }) {
  return (
    <div className="flex h-11 items-center rounded-xl border border-border bg-surface-2">
      <button type="button" className="h-full px-4 text-lg font-semibold text-muted" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Diminuir">
        −
      </button>
      <input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          if (n) onChange(Math.min(max, n));
        }}
        className="num h-full w-full min-w-0 bg-transparent text-center text-base font-semibold outline-none"
      />
      <button type="button" className="h-full px-4 text-lg font-semibold text-muted" onClick={() => onChange(Math.min(max, value + 1))} aria-label="Aumentar">
        +
      </button>
    </div>
  );
}

export function FormFooter({
  onSave,
  saveLabel = "Salvar",
  busy,
  disabled,
  onDelete,
  extra,
}: {
  onSave: () => void;
  saveLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  onDelete?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div
      className="sticky bottom-0 z-10 -mx-5 -mb-4 flex items-center gap-2 border-t border-border bg-surface px-5 pt-3"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 14px)" }}
    >
      {onDelete && (
        <Button variant="danger" onClick={onDelete} aria-label="Excluir" className="px-3">
          <Trash2 size={18} />
        </Button>
      )}
      {extra}
      <Button className="flex-1" onClick={onSave} disabled={busy || disabled}>
        {busy ? "Salvando…" : saveLabel}
      </Button>
    </div>
  );
}

export function confirmDelete(what: string): boolean {
  return window.confirm(`Excluir ${what}? Essa ação não pode ser desfeita.`);
}
