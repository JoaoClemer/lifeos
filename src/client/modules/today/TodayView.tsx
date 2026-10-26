import { Activity, CalendarDays, CalendarPlus, CheckCircle2, ListPlus, Receipt, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { formatBRL } from "../../../shared/money";
import { monthLabel } from "../../../shared/month";
import type { Project } from "../../../shared/tasks";
import type { Today, Week } from "../../../shared/today";
import { formatPlanDuration, isDoneStatus } from "../../../shared/training";
import { longDate } from "../../dates";
import { type NewTab, useApp, useData } from "../../state";
import { Button, Card, cx, LinkButton, List, LoadError, Money, Progress, Section } from "../../ui";
import { useAccounts } from "../../forms/common";
import { ExpenseRow } from "../../views/ExpenseRow";
import { ListSkeleton } from "../../views/ExpensesView";
import type { Recurring } from "../../../shared/types";
import { EventRow } from "../agenda/EventRow";
import { TaskRow } from "../tasks/TaskRow";
import { GettingStarted } from "./GettingStarted";
import { sessionTitle, TrainingRow } from "../training/TrainingRow";

export function TodayView() {
  const { navigate, openSheet, refresh, currentMonth } = useApp();
  const { data, error } = useData<Today>("/api/today");
  const week = useData<Week>("/api/week").data;
  const projects = new Map((useData<Project[]>("/api/projects?all=1").data ?? []).map((p) => [p.id, p]));
  const accounts = new Map(useAccounts().map((a) => [a.id, a]));
  const budgets = new Map((useData<Recurring[]>(`/api/recurring?month=${currentMonth}&all=1`).data ?? []).map((r) => [r.id, r]));
  if (!data) return error ? <LoadError error={error} onRetry={refresh} /> : <ListSkeleton />;
  const { events, upcoming, tasks, training, finance, spending } = data;
  const dueToday = tasks.overdue.length + tasks.today.length;
  const nextTraining = training.find((s) => s.status === "planned");
  const trainingTile = !training.length
    ? { value: "Descanso", hint: "nada planejado" }
    : nextTraining
      ? { value: nextTraining.planned_duration_s ? formatPlanDuration(nextTraining.planned_duration_s) : "Planejado", hint: sessionTitle(nextTraining) }
      : { value: training.some((s) => isDoneStatus(s.status)) ? "Feito" : "—", hint: sessionTitle(training[0]) };
  const quick = (tab: NewTab) =>
    openSheet({ kind: "new", tab, ...(tab === "training" ? { training: { date: data.date } } : {}), ...(tab === "event" ? { event: { date: data.date } } : {}) });
  const monthName = monthLabel(finance.month).split(" de ")[0];

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-2xl font-bold tracking-tight">{longDate(data.date)}</p>
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5">
          <QuickAction icon={<ListPlus size={16} />} label="Tarefa" onClick={() => quick("task")} />
          <QuickAction icon={<CalendarPlus size={16} />} label="Evento" onClick={() => quick("event")} />
          <QuickAction icon={<Activity size={16} />} label="Treino" onClick={() => quick("training")} />
          <QuickAction icon={<Receipt size={16} />} label="Gasto" onClick={() => quick("expense")} />
        </div>
      </div>

      <GettingStarted />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Compromissos" value={String(events.length)} hint={events.length ? nextEventHint(data) : "agenda livre"} onClick={() => navigate("agenda/day")} />
        <Tile
          label="Tarefas para hoje"
          value={String(dueToday)}
          hint={tasks.overdue.length ? `${tasks.overdue.length} atrasada${tasks.overdue.length > 1 ? "s" : ""}` : "nenhuma atrasada"}
          tone={tasks.overdue.length ? "danger" : undefined}
          onClick={() => navigate("tasks")}
        />
        <Tile label="Treino" value={trainingTile.value} hint={trainingTile.hint} onClick={() => navigate("training")} />
        <Tile
          label={finance.leftover_cents != null ? "Sobra prevista" : "Gastos do mês"}
          value={formatBRL(finance.leftover_cents ?? finance.total_cents)}
          hint={monthName}
          tone={finance.leftover_cents != null && finance.leftover_cents < 0 ? "danger" : undefined}
          onClick={() => navigate("summary")}
        />
      </div>

      <Section title="Agenda de hoje" action={<LinkButton onClick={() => navigate("agenda/day")}>Ver agenda</LinkButton>}>
        {events.length ? (
          <List>
            {events.map((e) => (
              <EventRow key={`${e.event_id}-${e.occurrence_start ?? ""}`} item={e} day={data.date} />
            ))}
          </List>
        ) : (
          <EmptyLine icon={<CalendarDays size={18} />} text="Nada na agenda hoje." />
        )}
      </Section>

      <Section title="Tarefas" action={<LinkButton onClick={() => navigate("tasks")}>Ver todas</LinkButton>}>
        {dueToday + tasks.priority.length ? (
          <List>
            {tasks.overdue.map((t) => (
              <TaskRow key={t.id} task={t} projects={projects} />
            ))}
            {tasks.today.map((t) => (
              <TaskRow key={t.id} task={t} projects={projects} hideDue />
            ))}
            {tasks.priority.map((t) => (
              <TaskRow key={t.id} task={t} projects={projects} />
            ))}
          </List>
        ) : (
          <EmptyLine icon={<CheckCircle2 size={18} />} text="Nenhuma tarefa para hoje." />
        )}
      </Section>

      <Section title="Treino de hoje" action={<LinkButton onClick={() => navigate("training")}>Ver semana</LinkButton>}>
        {training.length ? (
          <List>
            {training.map((s) => (
              <TrainingRow key={s.id} session={s} />
            ))}
          </List>
        ) : (
          <button type="button" className="w-full text-left" onClick={() => quick("training")}>
            <EmptyLine icon={<Activity size={18} />} text="Nenhum treino planejado. Toque para planejar ou registrar." />
          </button>
        )}
      </Section>

      <Section
        title="Gastos de hoje"
        action={spending.items.length > 0 && <Money cents={spending.total_cents} className="text-[15px] font-bold" />}
      >
        {spending.items.length ? (
          <>
            <List>
              {spending.items.map((e) => (
                <ExpenseRow
                  key={e.id}
                  expense={e}
                  account={e.account_id ? accounts.get(e.account_id) : undefined}
                  budget={e.budget_id ? budgets.get(e.budget_id) : undefined}
                />
              ))}
            </List>
            {spending.shared_cents > 0 && (
              <p className="px-1 text-[13px] text-muted">
                Total da sua parte. Mais {formatBRL(spending.shared_cents)} de outras pessoas, a receber.
              </p>
            )}
          </>
        ) : (
          <button type="button" className="w-full text-left" onClick={() => quick("expense")}>
            <EmptyLine icon={<Receipt size={18} />} text="Nenhum gasto lançado hoje. Toque para lançar." />
          </button>
        )}
      </Section>

      <Section title={`Finanças de ${monthName}`} action={<LinkButton onClick={() => navigate("summary")}>Abrir resumo</LinkButton>}>
        <Card className="space-y-3 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Figure label="Gastos do mês" value={<Money cents={finance.total_cents} />} />
            {finance.leftover_cents != null && (
              <Figure label="Sobra prevista" value={<Money cents={finance.leftover_cents} className={cx(finance.leftover_cents < 0 && "text-danger")} />} />
            )}
            {finance.closing_cents != null && (
              <Figure label="Saldo final previsto" value={<Money cents={finance.closing_cents} className={cx(finance.closing_cents < 0 && "text-danger")} />} />
            )}
          </div>
          {finance.budgets_attention.length > 0 && (
            <div className="space-y-2 border-t border-border pt-3">
              {finance.budgets_attention.map((b) => (
                <div key={b.id} className="space-y-1">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium">{b.description}</span>
                    <span className={cx("num", b.remaining_cents < 0 ? "font-semibold text-danger" : "text-warn")}>
                      {b.remaining_cents < 0 ? `estourou ${formatBRL(-b.remaining_cents)}` : `restam ${formatBRL(b.remaining_cents)}`}
                    </span>
                  </div>
                  <Progress value={b.spent_cents} max={b.limit_cents} />
                </div>
              ))}
            </div>
          )}
          {finance.receivable_pending_cents > 0 && (
            <button type="button" className="flex w-full items-center justify-between border-t border-border pt-3 text-sm" onClick={() => navigate("receivables")}>
              <span className="flex items-center gap-2 text-muted">
                <Wallet size={15} /> A receber de outras pessoas
              </span>
              <Money cents={finance.receivable_pending_cents} className="font-semibold" />
            </button>
          )}
        </Card>
      </Section>

      {week && <WeekCard week={week} />}

      {upcoming.length > 0 && (
        <Section title="Próximos compromissos">
          <List>
            {upcoming.map((e) => (
              <EventRow key={`${e.event_id}-${e.occurrence_start ?? ""}`} item={e} showDay />
            ))}
          </List>
        </Section>
      )}
    </div>
  );
}

/** "próximo às 14:00", "dia inteiro" ou "já passaram". */
function nextEventHint(data: Today): string {
  const next = data.events.find((e) => !e.all_day && e.end_at > data.now);
  if (next) return `próximo às ${next.start_at.slice(0, 10) < data.date ? "agora" : next.start_at.slice(11)}`;
  return data.events.some((e) => e.all_day) ? "dia inteiro" : "já passaram";
}

function WeekCard({ week }: { week: Week }) {
  const { navigate } = useApp();
  const t = week.training;
  const taskHint = [
    week.tasks.due_open.length ? `${week.tasks.due_open.length} com prazo na semana` : null,
    week.tasks.overdue ? `${week.tasks.overdue} atrasada${week.tasks.overdue > 1 ? "s" : ""}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Section title="Esta semana">
      <Card className="divide-y divide-border overflow-hidden">
        <WeekLine label="Compromissos" value={String(week.events)} onClick={() => navigate("agenda/week")} />
        <WeekLine label="Tarefas concluídas" value={String(week.tasks.done.length)} hint={taskHint || undefined} onClick={() => navigate("tasks/done")} />
        <WeekLine
          label="Treinos feitos"
          value={t.planned ? `${t.done} de ${t.planned}` : String(t.done)}
          hint={t.compliance_pct != null ? `${t.compliance_pct}% do plano até agora` : t.planned ? "nada venceu ainda" : undefined}
          onClick={() => navigate("training")}
        />
      </Card>
    </Section>
  );
}

function WeekLine({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface-2/60">
      <span>
        <span className="block text-[15px] font-medium">{label}</span>
        {hint && <span className="block text-[13px] text-muted">{hint}</span>}
      </span>
      <span className="num text-lg font-semibold">{value}</span>
    </button>
  );
}

function Tile({ label, value, hint, tone, onClick }: { label: string; value: string; hint?: string; tone?: "danger"; onClick: () => void }) {
  return (
    <Card onClick={onClick} className="p-3.5">
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <p className={cx("num mt-1 truncate text-xl font-bold tracking-tight", tone === "danger" && "text-danger")}>{value}</p>
      {hint && <p className="mt-0.5 truncate text-xs text-muted">{hint}</p>}
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[13px] text-muted">{label}</p>
      <p className="text-base font-semibold">{value}</p>
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" className="h-9 shrink-0 rounded-full px-3.5 text-sm" onClick={onClick}>
      {icon} {label}
    </Button>
  );
}

function EmptyLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted">
      {icon} {text}
    </div>
  );
}
