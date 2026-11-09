import { UserPlus, X } from "lucide-react";
import { formatBRL } from "../../shared/money";
import { useData } from "../state";
import { inputCls, MoneyInput, Toggle } from "../ui";

export interface SplitRow {
  person: string;
  amount: number | null;
}

export const EMPTY_SPLIT: SplitRow[] = [{ person: "", amount: null }];

/** Valor de cada pessoa: quem tem valor fica com ele; o resto é dividido igualmente entre você e os demais. */
export function computeSplits(total: number, rows: SplitRow[]) {
  const valid = rows.filter((r) => r.person.trim());
  const fixed = valid.reduce((s, r) => s + (r.amount ?? 0), 0);
  const flexible = valid.filter((r) => r.amount == null).length;
  const each = flexible ? Math.floor((total - fixed) / (flexible + 1)) : 0;
  const splits = valid.map((r) => ({ person: r.person.trim(), amount_cents: r.amount ?? each }));
  return { splits, mine: total - splits.reduce((s, x) => s + x.amount_cents, 0) };
}

/** "Dividir com alguém": pessoas e a parte de cada uma (avulsos, parcelados e fixos). */
export function SplitFields({
  on,
  onToggle,
  rows,
  onRows,
  total,
  split,
  description = "A parte dos outros vai para Devedores",
  mineLabel = "Sua parte",
}: {
  on: boolean;
  onToggle: (on: boolean) => void;
  rows: SplitRow[];
  onRows: (rows: SplitRow[]) => void;
  /** Valor que está sendo dividido (para sugerir a parte igual). */
  total: number | null;
  split: ReturnType<typeof computeSplits>;
  description?: string;
  mineLabel?: string;
}) {
  const people = useData<string[]>("/api/people").data ?? [];
  return (
    <div className="rounded-2xl border border-border p-3">
      <Toggle checked={on} onChange={onToggle} label="Dividir com alguém" description={description} />
      {on && (
        <div className="mt-3 space-y-2">
          <datalist id="people-list">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                list="people-list"
                placeholder="Nome"
                aria-label="Nome da pessoa"
                value={r.person}
                onChange={(e) => onRows(rows.map((x, j) => (j === i ? { ...x, person: e.target.value } : x)))}
                className={inputCls + " flex-1"}
              />
              <div className="w-36">
                <MoneyInput
                  value={r.amount}
                  placeholder={total ? formatBRL(split.splits[i]?.amount_cents ?? 0).replace("R$", "").trim() : "igual"}
                  onChange={(v) => onRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))}
                />
              </div>
              {rows.length > 1 && (
                <button type="button" aria-label="Remover pessoa" className="p-1 text-muted" onClick={() => onRows(rows.filter((_, j) => j !== i))}>
                  <X size={18} />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between pt-1">
            <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-accent" onClick={() => onRows([...rows, { person: "", amount: null }])}>
              <UserPlus size={16} /> Pessoa
            </button>
            <span className={split.mine < 0 ? "text-sm font-semibold text-danger" : "text-sm text-muted"}>
              {mineLabel}: <b className="num text-text">{formatBRL(split.mine)}</b>
            </span>
          </div>
          <p className="text-xs text-muted">Deixe o valor vazio para dividir igualmente.</p>
        </div>
      )}
    </div>
  );
}
