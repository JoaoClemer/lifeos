import { CheckCircle2, FolderKanban, ListTodo, Plus } from "lucide-react";
import { useState } from "react";
import { addDays } from "../../../shared/datetime";
import { dueGroup, type DueGroup, PROJECT_STATUS_LABEL, type Project, type Task, type TaskPriority } from "../../../shared/tasks";
import { relativeDay } from "../../dates";
import { useApp, useData } from "../../state";
import { Badge, Button, Card, Chips, Empty, List, Progress, Section, Segmented } from "../../ui";
import { ListSkeleton } from "../../views/ExpensesView";
import { TaskRow } from "./TaskRow";

type Sub = "open" | "done" | "projects";

export function TasksView() {
  const { route, navigate } = useApp();
  const sub = (["open", "done", "projects"].includes(route.sub ?? "") ? route.sub : "open") as Sub;
  return (
    <div className="space-y-5">
      <Segmented<Sub>
        options={[
          { value: "open", label: "Abertas" },
          { value: "done", label: "Concluídas" },
          { value: "projects", label: "Projetos" },
        ]}
        value={sub}
        onChange={(v) => navigate(`tasks/${v}`)}
      />
      {sub === "open" && <OpenTasks />}
      {sub === "done" && <DoneTasks />}
      {sub === "projects" && <Projects />}
    </div>
  );
}

function useProjects() {
  const list = useData<Project[]>("/api/projects?all=1").data;
  return { list, byId: new Map((list ?? []).map((p) => [p.id, p])) };
}

const GROUPS: { key: DueGroup; title: string }[] = [
  { key: "overdue", title: "Atrasadas" },
  { key: "today", title: "Hoje" },
  { key: "week", title: "Próximos 7 dias" },
  { key: "later", title: "Mais adiante" },
  { key: "none", title: "Sem prazo" },
];

function OpenTasks() {
  const { today, route, navigate, openSheet } = useApp();
  const projectFilter = route.params.get("project") ? Number(route.params.get("project")) : null;
  const [priority, setPriority] = useState<TaskPriority | null>(null);
  const query = new URLSearchParams({ status: "open" });
  if (projectFilter) query.set("project_id", String(projectFilter));
  if (priority) query.set("priority", priority);
  const tasks = useData<Task[]>(`/api/tasks?${query}`).data;
  const doneToday = (useData<Task[]>("/api/tasks?status=done&limit=100").data ?? []).filter((t) => t.completed_at?.startsWith(today)).length;
  const projects = useProjects();
  const active = (projects.list ?? []).filter((p) => p.status === "active" || p.id === projectFilter);

  const setProject = (id: number | null) => navigate(id ? `tasks/open?project=${id}` : "tasks/open");
  const newTask = () => openSheet({ kind: "new", tab: "task", task: { project_id: projectFilter } });

  if (!tasks) return <ListSkeleton />;
  const weekEnd = addDays(today, 7);
  const groups = GROUPS.map((g) => ({ ...g, items: tasks.filter((t) => dueGroup(t, today, weekEnd) === g.key) })).filter((g) => g.items.length);
  const overdue = groups.find((g) => g.key === "overdue")?.items.length ?? 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {active.length > 0 && (
          <Chips<number | null> options={[{ value: null, label: "Todos os projetos" }, ...active.map((p) => ({ value: p.id, label: p.name }))]} value={projectFilter} onChange={setProject} />
        )}
        <Chips<TaskPriority | null>
          options={[
            { value: null, label: "Qualquer prioridade" },
            { value: "high", label: "Alta" },
            { value: "medium", label: "Média" },
            { value: "low", label: "Baixa" },
          ]}
          value={priority}
          onChange={setPriority}
        />
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-sm text-muted">
          {tasks.length} {tasks.length === 1 ? "aberta" : "abertas"}
          {overdue > 0 && <span className="font-semibold text-danger"> · {overdue} atrasada{overdue > 1 ? "s" : ""}</span>}
          {doneToday > 0 && <span className="text-success"> · {doneToday} concluída{doneToday > 1 ? "s" : ""} hoje</span>}
        </p>
        <Button variant="ghost" className="h-8 px-2 text-sm" onClick={newTask}>
          <Plus size={16} /> Tarefa
        </Button>
      </div>

      {groups.length === 0 ? (
        <Empty
          icon={<ListTodo size={22} />}
          title={projectFilter || priority ? "Nenhuma tarefa com esses filtros" : "Nada pendente"}
          text="Anote o que precisa fazer. Prazo é opcional: dá para reservar um horário na agenda depois."
          action={<Button onClick={newTask}>Nova tarefa</Button>}
        />
      ) : (
        groups.map((g) => (
          <Section key={g.key} title={`${g.title} · ${g.items.length}`}>
            <List>
              {g.items.map((t) => (
                <TaskRow key={t.id} task={t} projects={projects.byId} hideDue={g.key === "today"} />
              ))}
            </List>
          </Section>
        ))
      )}
    </div>
  );
}

function DoneTasks() {
  const { today } = useApp();
  const tasks = useData<Task[]>("/api/tasks?status=done&limit=200").data;
  const projects = useProjects();
  if (!tasks) return <ListSkeleton />;
  if (!tasks.length) return <Empty icon={<CheckCircle2 size={22} />} title="Nenhuma tarefa concluída ainda" />;
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    const day = t.completed_at?.slice(0, 10) ?? "";
    byDay.set(day, [...(byDay.get(day) ?? []), t]);
  }
  return (
    <div className="space-y-5">
      <p className="px-1 text-sm text-muted">Toque no círculo para reabrir uma tarefa.</p>
      {[...byDay].map(([day, items]) => (
        <Section key={day} title={`${day ? relativeDay(day, today) : "Sem data"} · ${items.length}`}>
          <List>
            {items.map((t) => (
              <TaskRow key={t.id} task={t} projects={projects.byId} />
            ))}
          </List>
        </Section>
      ))}
    </div>
  );
}

function Projects() {
  const { today, navigate, openSheet } = useApp();
  const { list } = useProjects();
  if (!list) return <ListSkeleton />;
  const add = (
    <Button variant="ghost" className="h-8 px-2 text-sm" onClick={() => openSheet({ kind: "project" })}>
      <Plus size={16} /> Projeto
    </Button>
  );
  if (!list.length) {
    return (
      <Empty
        icon={<FolderKanban size={22} />}
        title="Nenhum projeto"
        text="Projetos agrupam tarefas de um mesmo objetivo, como uma mudança ou uma reforma."
        action={<Button onClick={() => openSheet({ kind: "project" })}>Criar projeto</Button>}
      />
    );
  }
  return (
    <Section title="Projetos" action={add}>
      <div className="space-y-3">
        {list.map((p) => {
          const total = p.open_count + p.done_count;
          return (
            <Card key={p.id} className="space-y-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.name}</p>
                  <p className="text-sm text-muted">
                    {total ? `${p.done_count} de ${total} tarefas concluídas` : "Sem tarefas"}
                    {p.due_date && ` · prazo ${relativeDay(p.due_date, today)}`}
                  </p>
                </div>
                {p.status !== "active" && <Badge tone={p.status === "done" ? "success" : "neutral"}>{PROJECT_STATUS_LABEL[p.status]}</Badge>}
              </div>
              {total > 0 && <Progress value={p.done_count} max={total} goal />}
              <div className="flex gap-2">
                <Button variant="secondary" className="h-9 flex-1 text-sm" onClick={() => navigate(`tasks/open?project=${p.id}`)}>
                  Ver tarefas
                </Button>
                <Button variant="ghost" className="h-9 text-sm" onClick={() => openSheet({ kind: "project", item: p })}>
                  Editar
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
