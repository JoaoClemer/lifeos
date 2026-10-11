import { useState } from "react";
import { EVENT_COLORS, type EditScope, lastDay, type Occurrence } from "../../../shared/agenda";
import { addMinutes, diffMinutes, nowIn } from "../../../shared/datetime";
import { formatRRule, type Freq, parseRRule, type RRule, WEEKDAYS, type Weekday } from "../../../shared/recurrence";
import type { Task } from "../../../shared/tasks";
import { api } from "../../api";
import { FormFooter, NumberInput } from "../../forms/common";
import { type EventDefaults, useApp, useData, useMutation } from "../../state";
import { Button, Chips, cx, Field, Segmented, TextArea, TextInput, Toggle } from "../../ui";
import { eventColor } from "./EventRow";

type RepeatFreq = "none" | Freq;
type EndMode = "never" | "until" | "count";

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

const weekdayOf = (date: string): Weekday => WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

/** Próxima hora cheia (ex.: 14:20 → 15:00), limitada ao mesmo dia. */
function nextHour(now: string): string {
  const h = Math.min(Number(now.slice(11, 13)) + 1, 23);
  return `${String(h).padStart(2, "0")}:00`;
}

export function EventForm({ item, defaults, onDone }: { item?: Occurrence; defaults?: EventDefaults; onDone: () => void }) {
  const { today, timezone } = useApp();
  const { run, busy } = useMutation();
  const categories = useData<string[]>("/api/events/categories").data ?? [];

  const initialRule: RRule | null = item?.rrule ? parseRRule(item.rrule) : null;
  const firstDate = item?.start_at.slice(0, 10) ?? defaults?.date ?? today;
  const startTime0 = item && !item.all_day ? item.start_at.slice(11) : firstDate === today ? nextHour(nowIn(timezone)) : "09:00";
  const end0 = item ? (item.all_day ? `${lastDay(item)}T${startTime0}` : item.end_at) : addMinutes(`${firstDate}T${startTime0}`, 60);

  const [title, setTitle] = useState(item?.title ?? defaults?.title ?? "");
  const [allDay, setAllDay] = useState(item?.all_day ?? false);
  const [startDate, setStartDate] = useState(firstDate);
  const [startTime, setStartTime] = useState(startTime0);
  const [endDate, setEndDate] = useState(end0.slice(0, 10));
  const [endTime, setEndTime] = useState(item?.all_day ? addMinutes(`${firstDate}T${startTime0}`, 60).slice(11) : end0.slice(11));
  const [freq, setFreq] = useState<RepeatFreq>(initialRule?.freq ?? "none");
  const [every, setEvery] = useState(initialRule?.interval ?? 1);
  const [byday, setByday] = useState<Weekday[]>(initialRule?.byday ?? [weekdayOf(firstDate)]);
  const [endMode, setEndMode] = useState<EndMode>(initialRule?.until ? "until" : initialRule?.count ? "count" : "never");
  const [until, setUntil] = useState(initialRule?.until ?? "");
  const [count, setCount] = useState(initialRule?.count ?? 10);
  const [location, setLocation] = useState(item?.location ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [category, setCategory] = useState(item?.category ?? "");
  const [color, setColor] = useState<string | null>(item?.color ?? null);
  const [description, setDescription] = useState(item?.description ?? "");
  const [taskId, setTaskId] = useState<number | null>(item?.task_id ?? defaults?.taskId ?? null);
  const [scope, setScope] = useState<EditScope>("this");
  const task = useData<Task>(taskId ? `/api/tasks/${taskId}` : null).data;

  const recurring = !!item?.rrule;
  const repeatLocked = recurring && scope === "this";

  /** Mudar o início leva o fim junto, mantendo a duração. */
  function moveStart(date: string, time: string) {
    const minutes = diffMinutes(`${startDate}T${startTime}`, `${endDate}T${endTime}`);
    const end = addMinutes(`${date}T${time}`, Math.max(minutes, allDay ? 0 : 15));
    setStartDate(date);
    setStartTime(time);
    setEndDate(end.slice(0, 10));
    setEndTime(end.slice(11));
  }

  const rrule =
    freq === "none"
      ? null
      : formatRRule({
          freq,
          interval: every,
          byday: freq === "WEEKLY" ? byday : undefined,
          until: endMode === "until" && until ? until : undefined,
          count: endMode === "count" ? count : undefined,
        });
  const timing = allDay ? { all_day: true, start: startDate, end: endDate } : { all_day: false, start: `${startDate}T${startTime}`, end: `${endDate}T${endTime}` };
  const fields = {
    title,
    location: location.trim() || null,
    url: url.trim() || null,
    category: category.trim() || null,
    color,
    description: description.trim() || null,
    task_id: taskId,
  };
  const valid = title.trim() && startDate && endDate && (freq !== "WEEKLY" || byday.length > 0) && (endMode !== "until" || until);

  async function save() {
    if (!valid) return;
    if (!item) {
      if (await run(() => api.post("/api/events", { ...fields, ...timing, rrule }), "Evento criado")) onDone();
      return;
    }
    // Só envia horário e repetição se mudaram: assim alterações individuais de uma série são preservadas quando possível
    const originalTiming = item.all_day
      ? { all_day: true, start: item.start_at.slice(0, 10), end: lastDay(item) }
      : { all_day: false, start: item.start_at, end: item.end_at };
    const body: Record<string, unknown> = { ...fields };
    if (JSON.stringify(timing) !== JSON.stringify(originalTiming)) Object.assign(body, timing);
    if (!repeatLocked && rrule !== item.rrule) body.rrule = rrule;
    if (recurring) Object.assign(body, { scope, occurrence_start: item.occurrence_start });
    if (await run(() => api.patch(`/api/events/${item.event_id}`, body), "Evento salvo")) onDone();
  }

  async function remove() {
    if (!item) return;
    const what = !recurring ? `o evento "${item.title}"` : scope === "this" ? "só esta ocorrência" : scope === "following" ? "esta e as próximas ocorrências" : "todas as ocorrências deste evento";
    if (!window.confirm(`Excluir ${what}? Essa ação não pode ser desfeita.`)) return;
    const q = recurring ? `?${new URLSearchParams({ scope, occurrence_start: item.occurrence_start! })}` : "";
    if (await run(() => api.del(`/api/events/${item.event_id}${q}`), "Evento excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      {recurring && (
        <Field label="Este evento se repete. Aplicar a:">
          <Segmented<EditScope>
            options={[
              { value: "this", label: "Só este" },
              { value: "following", label: "Este e os próximos" },
              { value: "all", label: "Todos" },
            ]}
            value={scope}
            onChange={setScope}
          />
        </Field>
      )}

      <Field label="Título" htmlFor="ev-title">
        <TextInput id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Consulta, Reunião, Aniversário" autoFocus={!item} />
      </Field>

      {taskId && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-accent-soft px-3 py-2 text-sm">
          <span>
            Horário reservado para a tarefa <strong>{task?.title ?? "…"}</strong>
          </span>
          <button type="button" className="font-semibold text-accent" onClick={() => setTaskId(null)}>
            Desvincular
          </button>
        </div>
      )}

      <Toggle checked={allDay} onChange={setAllDay} label="Dia inteiro" />
      <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-3">
        <Field label={allDay ? "Primeiro dia" : "Início"} htmlFor="ev-start-date">
          <TextInput id="ev-start-date" type="date" value={startDate} onChange={(e) => e.target.value && moveStart(e.target.value, startTime)} />
        </Field>
        {!allDay ? (
          <Field label="Hora" htmlFor="ev-start-time">
            <TextInput id="ev-start-time" type="time" step={300} value={startTime} onChange={(e) => e.target.value && moveStart(startDate, e.target.value)} className="w-28" />
          </Field>
        ) : (
          <span />
        )}
        <Field label={allDay ? "Último dia" : "Fim"} htmlFor="ev-end-date">
          <TextInput id="ev-end-date" type="date" value={endDate} onChange={(e) => e.target.value && setEndDate(e.target.value)} />
        </Field>
        {!allDay && (
          <Field label="Hora" htmlFor="ev-end-time">
            <TextInput id="ev-end-time" type="time" step={300} value={endTime} onChange={(e) => e.target.value && setEndTime(e.target.value)} className="w-28" />
          </Field>
        )}
      </div>

      <Field label="Repetir">
        {repeatLocked ? (
          <p className="text-sm text-muted">Para mudar a repetição, escolha “Este e os próximos” ou “Todos”.</p>
        ) : (
          <div className="space-y-3">
            <Chips<RepeatFreq>
              options={[
                { value: "none", label: "Não repete" },
                { value: "DAILY", label: "Diariamente" },
                { value: "WEEKLY", label: "Semanalmente" },
                { value: "MONTHLY", label: "Mensalmente" },
                { value: "YEARLY", label: "Anualmente" },
              ]}
              value={freq}
              onChange={setFreq}
            />
            {freq !== "none" && (
              <>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted">A cada</span>
                  <div className="w-36">
                    <NumberInput value={every} onChange={setEvery} min={1} max={99} />
                  </div>
                  <span className="text-sm text-muted">{UNIT[freq][every > 1 ? 1 : 0]}</span>
                </div>
                {freq === "WEEKLY" && (
                  <div className="flex gap-1.5" role="group" aria-label="Dias da semana">
                    {WEEK.map((w) => {
                      const on = byday.includes(w.day);
                      return (
                        <button
                          key={w.day}
                          type="button"
                          aria-pressed={on}
                          aria-label={w.name}
                          onClick={() => setByday(on ? byday.filter((d) => d !== w.day) : [...byday, w.day])}
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
                    { value: "count", label: "Número de vezes" },
                  ]}
                  value={endMode}
                  onChange={setEndMode}
                />
                {endMode === "until" && <TextInput type="date" aria-label="Repetir até" value={until} min={startDate} onChange={(e) => setUntil(e.target.value)} />}
                {endMode === "count" && (
                  <div className="w-36">
                    <NumberInput value={count} onChange={setCount} min={1} max={1000} />
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Field>

      <Field label="Local" htmlFor="ev-location">
        <TextInput id="ev-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Opcional" />
      </Field>
      <Field label="Link da reunião" htmlFor="ev-url">
        <TextInput id="ev-url" type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Categoria" htmlFor="ev-category">
        <TextInput id="ev-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ex.: Trabalho, Saúde, Família" />
        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {categories
              .filter((c) => c !== category)
              .slice(0, 8)
              .map((c) => (
                <button key={c} type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted hover:text-text" onClick={() => setCategory(c)}>
                  {c}
                </button>
              ))}
          </div>
        )}
      </Field>
      <Field label="Cor">
        <div className="flex gap-2" role="radiogroup" aria-label="Cor">
          {[null, ...EVENT_COLORS].map((c) => (
            <button
              key={c ?? "padrão"}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={c ?? "padrão"}
              onClick={() => setColor(c)}
              className={cx("h-8 w-8 rounded-full ring-offset-2 ring-offset-surface transition", color === c && "ring-2 ring-text")}
              style={{ background: eventColor(c) }}
            />
          ))}
        </div>
      </Field>
      <Field label="Descrição" htmlFor="ev-desc">
        <TextArea id="ev-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {item?.url && (
        <Button variant="secondary" className="w-full" onClick={() => window.open(item.url!, "_blank", "noopener")}>
          Abrir link da reunião
        </Button>
      )}

      <FormFooter onSave={save} busy={busy} disabled={!valid} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Criar evento"} />
    </div>
  );
}
