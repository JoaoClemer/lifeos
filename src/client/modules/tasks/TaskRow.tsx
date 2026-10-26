import { CalendarClock, ListChecks, Repeat } from "lucide-react";
import { describeRRule, parseRRule } from "../../../shared/recurrence";
import type { Project, Task } from "../../../shared/tasks";
import { api } from "../../api";
import { minutesLabel, relativeDay } from "../../dates";
import { useApp, useMutation } from "../../state";
import { Badge, CheckCircle, cx, Row } from "../../ui";

/** Conclui ou reabre a tarefa direto da lista. */
export function useToggleTask() {
  const { run } = useMutation();
  return (task: Pick<Task, "id" | "status"> & { rrule?: string | null }) =>
    run(
      () => api.patch(`/api/tasks/${task.id}`, { status: task.status === "done" ? "todo" : "done" }),
      task.status === "done" ? "Tarefa reaberta" : task.rrule ? "Tarefa concluída. A próxima já está na lista" : "Tarefa concluída",
    );
}

export function TaskRow({ task, projects, hideDue }: { task: Task; projects?: Map<number, Project>; hideDue?: boolean }) {
  const { today, openSheet, me } = useApp();
  const toggle = useToggleTask();
  const done = task.status === "done";
  const overdue = !done && !!task.due_date && task.due_date < today;
  const project = task.project_id ? projects?.get(task.project_id) : undefined;
  return (
    <Row
      label={task.title}
      left={<CheckCircle checked={done} label={done ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`} onClick={() => toggle(task)} />}
      title={<span className={cx(done && "text-muted line-through")}>{task.title}</span>}
      subtitle={
        <>
          {task.due_date && !hideDue && (
            <span className={cx("inline-flex items-center gap-1", overdue && "font-semibold text-danger")}>
              <CalendarClock size={13} /> {relativeDay(task.due_date, today)}
            </span>
          )}
          {task.priority === "high" && !done && <Badge tone="danger">Alta</Badge>}
          {task.priority === "low" && !done && <Badge>Baixa</Badge>}
          {task.status === "doing" && <Badge tone="accent">Em andamento</Badge>}
          {task.rrule && task.status !== "done" && (
            <span className="inline-flex items-center gap-1">
              <Repeat size={13} /> {describeRRule(parseRRule(task.rrule), task.due_date ?? undefined)}
            </span>
          )}
          {project && <span>{project.name}</span>}
          {task.subtasks_total > 0 && (
            <span className="inline-flex items-center gap-1">
              <ListChecks size={13} /> {task.subtasks_done}/{task.subtasks_total}
            </span>
          )}
          {task.estimate_minutes && !done && <span>{minutesLabel(task.estimate_minutes)}</span>}
          {task.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
          {task.assignee && task.assignee.id !== me.id && <Badge tone="accent">para {task.assignee.name ?? "pessoa"}</Badge>}
          {task.owner && <Badge>de {task.owner.name ?? "pessoa"}</Badge>}
        </>
      }
      onClick={() => openSheet({ kind: "task", item: task })}
    />
  );
}
