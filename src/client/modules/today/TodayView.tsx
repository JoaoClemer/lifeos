import { CalendarDays, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Today } from "../../../shared/today";
import type { Project } from "../../../shared/tasks";
import { longDate } from "../../dates";
import { useApp, useData } from "../../state";
import { LinkButton, List, Section } from "../../ui";
import { ListSkeleton } from "../../views/ExpensesView";
import { EventRow } from "../agenda/EventRow";
import { TaskRow } from "../tasks/TaskRow";

export function TodayView() {
  const { navigate } = useApp();
  const data = useData<Today>("/api/today").data;
  const projects = new Map((useData<Project[]>("/api/projects?all=1").data ?? []).map((p) => [p.id, p]));
  if (!data) return <ListSkeleton />;
  const { events, upcoming, tasks } = data;
  const taskCount = tasks.overdue.length + tasks.today.length;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-2xl font-bold tracking-tight">{longDate(data.date)}</p>
        <p className="mt-1 text-sm text-muted">
          {events.length ? `${events.length} ${events.length === 1 ? "compromisso" : "compromissos"}` : "Nenhum compromisso"}
          {" · "}
          {tasks.today.length ? `${tasks.today.length} ${tasks.today.length === 1 ? "tarefa" : "tarefas"} para hoje` : "nenhuma tarefa para hoje"}
          {tasks.overdue.length > 0 && (
            <span className="font-semibold text-danger">
              {" · "}
              {tasks.overdue.length} atrasada{tasks.overdue.length > 1 ? "s" : ""}
            </span>
          )}
        </p>
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
        {taskCount + tasks.priority.length ? (
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

function EmptyLine({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted">
      {icon} {text}
    </div>
  );
}
