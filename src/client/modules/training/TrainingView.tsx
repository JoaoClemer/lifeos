import { ChevronLeft, ChevronRight, Copy, Dumbbell, Plus } from "lucide-react";
import { addDays, isValidDate, startOfWeek } from "../../../shared/datetime";
import { monthLabel } from "../../../shared/month";
import { formatDistance, formatPlanDuration, SPORT_LABEL, SPORTS, type Sport, type SportVolume, type TrainingSession, type WeekStats } from "../../../shared/training";
import { api } from "../../api";
import { dayMonth, longDate, weekdayShort } from "../../dates";
import { useApp, useData, useMutation } from "../../state";
import { Badge, Button, Card, Chips, Empty, List, LoadError, Progress, Section, Segmented } from "../../ui";
import { ListSkeleton } from "../../views/ExpensesView";
import { SportIcon, TrainingRow } from "./TrainingRow";

type Sub = "week" | "history";

export function TrainingView() {
  const { route, navigate } = useApp();
  const sub = (route.sub === "history" ? "history" : "week") as Sub;
  return (
    <div className="space-y-5">
      <Segmented<Sub>
        options={[
          { value: "week", label: "Semana" },
          { value: "history", label: "Histórico" },
        ]}
        value={sub}
        onChange={(v) => navigate(`training/${v}`)}
      />
      {sub === "week" ? <Week /> : <History />}
    </div>
  );
}

function Week() {
  const { today, route, navigate, openSheet, toast, refresh } = useApp();
  const { run, busy } = useMutation();
  const dParam = route.params.get("d");
  const start = startOfWeek(dParam && isValidDate(dParam) ? dParam : today);
  const end = addDays(start, 6);
  const { data: sessions, error } = useData<TrainingSession[]>(`/api/training?from=${start}&to=${end}`);
  const stats = useData<WeekStats>(`/api/training/week?date=${start}`).data;
  const go = (date: string) => navigate(`training/week?d=${date}`);
  const isThisWeek = start === startOfWeek(today);

  async function copyPrevious() {
    const prev = addDays(start, -7);
    const msg = sessions?.length
      ? "Copiar o plano da semana anterior para esta? Os treinos já planejados nesta semana continuam."
      : "Copiar o plano da semana anterior para esta?";
    if (!window.confirm(msg)) return;
    const copied = await run(() => api.post<TrainingSession[]>("/api/training/copy-week", { from: prev, to: start }));
    if (copied) toast(copied.length ? `${copied.length} treino${copied.length > 1 ? "s" : ""} copiado${copied.length > 1 ? "s" : ""}` : "A semana anterior não tinha treinos planejados");
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-1">
        <button type="button" aria-label="Semana anterior" onClick={() => go(addDays(start, -7))} className="rounded-full p-2 text-muted hover:bg-surface-2">
          <ChevronLeft size={20} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">
          {dayMonth(start)} – {dayMonth(end, today)}
        </h2>
        <button type="button" aria-label="Próxima semana" onClick={() => go(addDays(start, 7))} className="rounded-full p-2 text-muted hover:bg-surface-2">
          <ChevronRight size={20} />
        </button>
        <Button variant="secondary" className="ml-1 h-8 px-3 text-sm" onClick={() => go(today)} disabled={isThisWeek}>
          Esta semana
        </Button>
      </div>

      {stats && <WeekSummary stats={stats} />}

      {!sessions ? (
        error ? <LoadError error={error} onRetry={refresh} /> : <ListSkeleton />
      ) : (
        <div className="space-y-4">
          {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((day) => {
            const list = sessions.filter((s) => s.date === day);
            return (
              <section key={day} className="space-y-2" aria-label={longDate(day)}>
                <div className="flex items-center justify-between px-1">
                  <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-wide text-muted">
                    {weekdayShort(day)}, {day.slice(8)}/{day.slice(5, 7)}
                    {day === today && <Badge tone="accent">Hoje</Badge>}
                  </p>
                  <button
                    type="button"
                    aria-label={`Planejar treino em ${longDate(day)}`}
                    onClick={() => openSheet({ kind: "new", tab: "training", training: { date: day } })}
                    className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-accent"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                {list.length ? (
                  <List>
                    {list.map((s) => (
                      <TrainingRow key={s.id} session={s} />
                    ))}
                  </List>
                ) : (
                  <p className="px-1 text-sm text-muted/70">Descanso</p>
                )}
              </section>
            );
          })}
          <Button variant="secondary" className="w-full" onClick={copyPrevious} disabled={busy}>
            <Copy size={16} /> Copiar o plano da semana anterior
          </Button>
        </div>
      )}
    </div>
  );
}

function volumeLine(v: SportVolume): string {
  const dist = v.planned_distance_m || v.actual_distance_m ? `${formatDistance(v.actual_distance_m, v.sport)} de ${formatDistance(v.planned_distance_m, v.sport)}` : null;
  const time = `${formatPlanDuration(v.actual_duration_s)} de ${formatPlanDuration(v.planned_duration_s)}`;
  return dist ? `${dist} · ${time}` : time;
}

function WeekSummary({ stats: s }: { stats: WeekStats }) {
  if (!s.planned && !s.done) return null;
  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted">Cumprimento do plano</p>
          <p className="num text-3xl font-bold tracking-tight">{s.compliance_pct == null ? "—" : `${s.compliance_pct}%`}</p>
        </div>
        <p className="text-right text-sm text-muted">
          {s.due ? `${s.due_done} de ${s.due} até hoje` : "Nada venceu ainda"}
          <br />
          {s.planned} planejado{s.planned === 1 ? "" : "s"} · {s.done} feito{s.done === 1 ? "" : "s"}
        </p>
      </div>
      {s.due > 0 && <Progress value={s.due_done} max={s.due} goal />}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
        {s.partial > 0 && <span>{s.partial} parcial</span>}
        {s.skipped > 0 && <span className="text-danger">{s.skipped} não realizado{s.skipped > 1 ? "s" : ""}</span>}
        {s.cancelled > 0 && <span>{s.cancelled} cancelado{s.cancelled > 1 ? "s" : ""}</span>}
        {s.unplanned > 0 && <span>{s.unplanned} sem plano</span>}
        <span>
          Duração: {formatPlanDuration(s.actual_duration_s)} de {formatPlanDuration(s.planned_duration_s)}
        </span>
      </div>
      {s.by_sport.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          {s.by_sport.map((v) => (
            <div key={v.sport} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <SportIcon sport={v.sport} /> {SPORT_LABEL[v.sport]}
                <span className="font-normal text-muted">· {v.sessions}</span>
              </span>
              <span className="num text-right text-muted">{volumeLine(v)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function History() {
  const { route, navigate } = useApp();
  const sportParam = route.params.get("sport");
  const sport = sportParam && (SPORTS as string[]).includes(sportParam) ? (sportParam as Sport) : null;
  const list = useData<TrainingSession[]>(`/api/training/history?limit=200${sport ? `&sport=${sport}` : ""}`).data;
  const filter = (
    <Chips<Sport | null>
      options={[{ value: null, label: "Todos" }, ...SPORTS.map((s) => ({ value: s, label: SPORT_LABEL[s], icon: <SportIcon sport={s} size={15} /> }))]}
      value={sport}
      onChange={(s) => navigate(s ? `training/history?sport=${s}` : "training/history")}
    />
  );
  if (!list) return <ListSkeleton />;
  if (!list.length) {
    return (
      <div className="space-y-4">
        {filter}
        <Empty icon={<Dumbbell size={22} />} title="Nenhum treino registrado" text="Os treinos marcados como realizados aparecem aqui." />
      </div>
    );
  }
  const byMonth = new Map<string, TrainingSession[]>();
  for (const s of list) byMonth.set(s.date.slice(0, 7), [...(byMonth.get(s.date.slice(0, 7)) ?? []), s]);
  return (
    <div className="space-y-5">
      {filter}
      {[...byMonth].map(([month, items]) => {
        const seconds = items.reduce((t, s) => t + (s.actual_duration_s ?? 0), 0);
        return (
          <Section key={month} title={`${monthLabel(month)} · ${items.length} treino${items.length > 1 ? "s" : ""} · ${formatPlanDuration(seconds)}`}>
            <List>
              {items.map((s) => (
                <TrainingRow key={s.id} session={s} showDay />
              ))}
            </List>
          </Section>
        );
      })}
    </div>
  );
}
