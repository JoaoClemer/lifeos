// Escolha de repetição (diária, semanal em dias escolhidos, mensal, anual; até uma data ou por número de vezes).
// Usado nos formulários de evento e de tarefa.
import { formatRRule, type Freq, parseRRule, WEEKDAYS, type Weekday } from "../shared/recurrence";
import { NumberInput } from "./forms/common";
import { Chips, cx, TextInput } from "./ui";

type EndMode = "never" | "until" | "count";

export interface Repeat {
  freq: "none" | Freq;
  every: number;
  byday: Weekday[];
  endMode: EndMode;
  until: string;
  count: number;
}

// Segunda a domingo
const WEEK: { day: Weekday; label: string; name: string }[] = [
  { day: "MO", label: "S", name: "segunda" },
  { day: "TU", label: "T", name: "terça" },
  { day: "WE", label: "Q", name: "quarta" },
  { day: "TH", label: "Q", name: "quinta" },
  { day: "FR", label: "S", name: "sexta" },
  { day: "SA", label: "S", name: "sábado" },
  { day: "SU", label: "D", name: "domingo" },
];
const UNIT: Record<Freq, [string, string]> = { DAILY: ["dia", "dias"], WEEKLY: ["semana", "semanas"], MONTHLY: ["mês", "meses"], YEARLY: ["ano", "anos"] };

export const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Estado inicial a partir de uma RRULE (ou "não repete"); `date` define o dia da semana padrão. */
export function initialRepeat(rrule: string | null, date: string): Repeat {
  const r = rrule ? parseRRule(rrule) : null;
  return {
    freq: r?.freq ?? "none",
    every: r?.interval ?? 1,
    byday: r?.byday ?? [weekdayOf(date)],
    endMode: r?.until ? "until" : r?.count ? "count" : "never",
    until: r?.until ?? "",
    count: r?.count ?? 10,
  };
}

/** RRULE na forma canônica (igual à do servidor), ou null se não repete. */
export function repeatRRule(r: Repeat): string | null {
  if (r.freq === "none") return null;
  return formatRRule({
    freq: r.freq,
    interval: r.every,
    byday: r.freq === "WEEKLY" ? r.byday : undefined,
    until: r.endMode === "until" && r.until ? r.until : undefined,
    count: r.endMode === "count" ? r.count : undefined,
  });
}

export function repeatValid(r: Repeat): boolean {
  return r.freq === "none" || ((r.freq !== "WEEKLY" || r.byday.length > 0) && (r.endMode !== "until" || !!r.until));
}

export function RepeatPicker({
  value: r,
  onChange,
  minDate,
  allowCount,
}: {
  value: Repeat;
  onChange: (r: Repeat) => void;
  /** Menor data aceita em "até uma data". */
  minDate?: string;
  /** Oferece "número de vezes" (eventos sim; tarefas terminam numa data). */
  allowCount?: boolean;
}) {
  const set = (patch: Partial<Repeat>) => onChange({ ...r, ...patch });
  return (
    <div className="space-y-3">
      <Chips<Repeat["freq"]>
        options={[
          { value: "none", label: "Não repete" },
          { value: "DAILY", label: "Diariamente" },
          { value: "WEEKLY", label: "Semanalmente" },
          { value: "MONTHLY", label: "Mensalmente" },
          { value: "YEARLY", label: "Anualmente" },
        ]}
        value={r.freq}
        onChange={(freq) => set({ freq })}
      />
      {r.freq !== "none" && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted">A cada</span>
            <div className="w-36">
              <NumberInput value={r.every} onChange={(every) => set({ every })} min={1} max={99} />
            </div>
            <span className="text-sm text-muted">{UNIT[r.freq][r.every > 1 ? 1 : 0]}</span>
          </div>
          {r.freq === "WEEKLY" && (
            <div className="flex gap-1.5" role="group" aria-label="Dias da semana">
              {WEEK.map((w) => {
                const on = r.byday.includes(w.day);
                return (
                  <button
                    key={w.day}
                    type="button"
                    aria-pressed={on}
                    aria-label={w.name}
                    onClick={() => set({ byday: on ? r.byday.filter((d) => d !== w.day) : [...r.byday, w.day] })}
                    className={cx(
                      "h-9 w-9 rounded-full border text-sm font-semibold transition",
                      on ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:bg-surface-2",
                    )}
                  >
                    {w.label}
                  </button>
                );
              })}
            </div>
          )}
          <Chips<EndMode>
            options={[
              { value: "never", label: "Sem fim" },
              { value: "until", label: "Até uma data" },
              ...(allowCount ? [{ value: "count" as const, label: "Número de vezes" }] : []),
            ]}
            value={r.endMode}
            onChange={(endMode) => set({ endMode })}
          />
          {r.endMode === "until" && <TextInput type="date" aria-label="Repetir até" value={r.until} min={minDate} onChange={(e) => set({ until: e.target.value })} />}
          {r.endMode === "count" && (
            <div className="w-36">
              <NumberInput value={r.count} onChange={(count) => set({ count })} min={1} max={1000} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
