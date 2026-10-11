import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { AgendaItem } from "../../../shared/agenda";
import { addDays, daysInMonth, isValidDate, startOfWeek } from "../../../shared/datetime";
import { addMonths, monthTitle } from "../../../shared/month";
import { dayMonth, longDate, relativeDay, weekdayShort } from "../../dates";
import { useApp, useData } from "../../state";
import { Badge, Button, cx, Empty, List, LoadError, Section, Segmented } from "../../ui";
import { ListSkeleton } from "../../views/ExpensesView";
import { TaskRow } from "../tasks/TaskRow";
import { sessionTitle, TrainingRow } from "../training/TrainingRow";
import { eventColor, type EventItem, EventRow } from "./EventRow";

type Mode = "day" | "week" | "month";

/** Itens que acontecem no dia (eventos de vários dias aparecem em todos). */
function itemsOn(items: AgendaItem[], day: string): AgendaItem[] {
  return items.filter((i) => (i.kind === "event" ? i.start_at.slice(0, 10) <= day && i.end_at > `${day}T00:00` : i.date === day));
}

function range(mode: Mode, d: string): [string, string] {
  if (mode === "day") return [d, d];
  if (mode === "week") return [startOfWeek(d), addDays(startOfWeek(d), 6)];
  const first = `${d.slice(0, 7)}-01`;
  const last = `${d.slice(0, 7)}-${daysInMonth(d.slice(0, 7))}`;
  return [startOfWeek(first), addDays(startOfWeek(last), 6)];
}

function step(mode: Mode, d: string, n: number): string {
  if (mode === "day") return addDays(d, n);
  if (mode === "week") return addDays(d, 7 * n);
  return `${addMonths(d.slice(0, 7), n)}-01`;
}

export function AgendaView() {
  const { today, route, navigate, openSheet, refresh } = useApp();
  const mode = (["day", "week", "month"].includes(route.sub ?? "") ? route.sub : "week") as Mode;
  const dParam = route.params.get("d");
  const d = dParam && isValidDate(dParam) ? dParam : today;
  const [from, to] = range(mode, d);
  const { data: items, error } = useData<AgendaItem[]>(`/api/agenda?from=${from}&to=${to}`);

  const go = (m: Mode, date: string) => navigate(`agenda/${m}?d=${date}`);
  const title = mode === "day" ? longDate(d) : mode === "week" ? `${dayMonth(from)} – ${dayMonth(to, today)}` : monthTitle(d.slice(0, 7));
  const newEvent = (date = d) => openSheet({ kind: "new", tab: "event", event: { date } });

  return (
    <div className="space-y-4">
      <Segmented<Mode>
        options={[
          { value: "day", label: "Dia" },
          { value: "week", label: "Semana" },
          { value: "month", label: "Mês" },
        ]}
        value={mode}
        onChange={(m) => go(m, d)}
      />
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Anterior" onClick={() => go(mode, step(mode, d, -1))} className="rounded-full p-2 text-muted hover:bg-surface-2">
          <ChevronLeft size={20} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">{title}</h2>
        <button type="button" aria-label="Próximo" onClick={() => go(mode, step(mode, d, 1))} className="rounded-full p-2 text-muted hover:bg-surface-2">
          <ChevronRight size={20} />
        </button>
        <Button variant="secondary" className="ml-1 h-8 px-3 text-sm" onClick={() => go(mode, today)} disabled={from <= today && today <= to && (mode !== "month" || d === today)}>
          Hoje
        </Button>
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => newEvent()} aria-label="Novo evento">
          <Plus size={16} /> <span className="hidden sm:inline">Evento</span>
        </Button>
      </div>

      {!items ? (
        error ? <LoadError error={error} onRetry={refresh} /> : <ListSkeleton />
      ) : mode === "day" ? (
        <DayList items={itemsOn(items, d)} day={d} onAdd={() => newEvent(d)} />
      ) : mode === "week" ? (
        <WeekList items={items} from={from} onAdd={newEvent} onOpenDay={(day) => go("day", day)} />
      ) : (
        <MonthGrid items={items} from={from} to={to} selected={d} onSelect={(day) => go("month", day)} onAdd={newEvent} />
      )}
    </div>
  );
}

function ItemList({ items, day }: { items: AgendaItem[]; day: string }) {
  return (
    <List>
      {items.map((i) =>
        i.kind === "event" ? (
          <EventRow key={`e${i.event_id}-${i.occurrence_start ?? ""}`} item={i} day={day} />
        ) : i.kind === "training" ? (
          <TrainingRow key={`w${i.session.id}`} session={i.session} />
        ) : (
          <TaskRow key={`t${i.task.id}`} task={i.task} hideDue />
        ),
      )}
    </List>
  );
}

function DayList({ items, day, onAdd }: { items: AgendaItem[]; day: string; onAdd: () => void }) {
  const events = items.filter((i) => i.kind !== "task_due");
  const due = items.filter((i) => i.kind === "task_due");
  if (!items.length) {
    return <Empty icon={<CalendarDays size={22} />} title="Dia livre" text="Nenhum compromisso nem prazo neste dia." action={<Button onClick={onAdd}>Novo evento</Button>} />;
  }
  return (
    <div className="space-y-5">
      {events.length > 0 && (
        <Section title="Agenda do dia">
          <ItemList items={events} day={day} />
        </Section>
      )}
      {due.length > 0 && (
        <Section title="Prazos de tarefas">
          <ItemList items={due} day={day} />
        </Section>
      )}
    </div>
  );
}

function WeekList({ items, from, onAdd, onOpenDay }: { items: AgendaItem[]; from: string; onAdd: (day: string) => void; onOpenDay: (day: string) => void }) {
  const { today } = useApp();
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const list = itemsOn(items, day);
        return (
          <section key={day} className="space-y-2" aria-label={longDate(day)}>
            <div className="flex items-center justify-between px-1">
              <button type="button" onClick={() => onOpenDay(day)} className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted hover:text-text">
                {weekdayShort(day)}, {day.slice(8)}/{day.slice(5, 7)}
                {day === today && <Badge tone="accent">Hoje</Badge>}
              </button>
              <button type="button" aria-label={`Novo evento em ${longDate(day)}`} onClick={() => onAdd(day)} className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-accent">
                <Plus size={16} />
              </button>
            </div>
            {list.length ? <ItemList items={list} day={day} /> : <p className="px-1 text-sm text-muted/70">Livre</p>}
          </section>
        );
      })}
    </div>
  );
}

function MonthGrid({
  items,
  from,
  to,
  selected,
  onSelect,
  onAdd,
}: {
  items: AgendaItem[];
  from: string;
  to: string;
  selected: string;
  onSelect: (day: string) => void;
  onAdd: (day: string) => void;
}) {
  const { today } = useApp();
  const days: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
  const month = selected.slice(0, 7);
  const selectedItems = itemsOn(items, selected);
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="grid grid-cols-7 border-b border-border text-center text-[11px] font-semibold uppercase text-muted">
          {["seg", "ter", "qua", "qui", "sex", "sáb", "dom"].map((w) => (
            <div key={w} className="py-2">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const list = itemsOn(items, day);
            const events = list.filter((i): i is EventItem => i.kind === "event");
            const trainings = list.flatMap((i) => (i.kind === "training" ? [i.session] : []));
            const dues = list.length - events.length - trainings.length;
            return (
              <button
                key={day}
                type="button"
                onClick={() => onSelect(day)}
                aria-label={`${longDate(day)}: ${list.length ? `${list.length} ${list.length === 1 ? "item" : "itens"}` : "livre"}`}
                aria-pressed={day === selected}
                className={cx(
                  "flex min-h-14 flex-col items-stretch gap-1 border-b border-r border-border p-1 text-left transition hover:bg-surface-2/60 md:min-h-24 [&:nth-child(7n)]:border-r-0",
                  day.slice(0, 7) !== month && "bg-surface-2/40 text-muted",
                  day === selected && "bg-accent-soft/70",
                )}
              >
                <span
                  className={cx(
                    "num mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold md:mx-0",
                    day === today && "bg-accent text-accent-fg",
                  )}
                >
                  {Number(day.slice(8))}
                </span>
                {/* Celular: pontos; telas maiores: títulos */}
                <span className="flex justify-center gap-0.5 md:hidden">
                  {events.slice(0, 3).map((e, i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ background: eventColor(e.color) }} />
                  ))}
                  {trainings.length > 0 && <span className="h-1.5 w-1.5 rounded-sm bg-success" />}
                  {dues > 0 && <span className="h-1.5 w-1.5 rounded-full bg-warn" />}
                </span>
                <span className="hidden space-y-0.5 md:block">
                  {events.slice(0, 3).map((e, i) => (
                    <span key={i} className="block truncate rounded px-1 text-[11px] font-medium text-text" style={{ background: `color-mix(in srgb, ${eventColor(e.color)} 18%, transparent)` }}>
                      {!e.all_day && e.start_at.slice(0, 10) === day ? `${e.start_at.slice(11)} ` : ""}
                      {e.title}
                    </span>
                  ))}
                  {trainings.slice(0, Math.max(0, 3 - events.length)).map((s) => (
                    <span key={s.id} className="block truncate rounded bg-success-soft px-1 text-[11px] font-medium text-success">
                      {s.time ? `${s.time} ` : ""}
                      {sessionTitle(s)}
                    </span>
                  ))}
                  {list.length - dues > 3 && <span className="block px-1 text-[11px] text-muted">+{list.length - dues - 3}</span>}
                  {list.length - dues <= 3 && dues > 0 && <span className="block px-1 text-[11px] text-warn">{dues} prazo{dues > 1 ? "s" : ""}</span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <Section
        title={relativeDay(selected, today)}
        action={
          <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => onAdd(selected)}>
            <Plus size={16} /> Evento
          </Button>
        }
      >
        {selectedItems.length ? <ItemList items={selectedItems} day={selected} /> : <p className="px-1 text-sm text-muted">Nada neste dia.</p>}
      </Section>
    </div>
  );
}
