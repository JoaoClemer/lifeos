import { CalendarPlus, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import type { CalendarEvent } from "../../../shared/agenda";
import { addDays, startOfWeek } from "../../../shared/datetime";
import type { Project, Task, TaskPriority, TaskStatus } from "../../../shared/tasks";
import { api } from "../../api";
import { relativeDay, timeLabel } from "../../dates";
import { confirmDelete, FormFooter } from "../../forms/common";
import { useApp, useData, useMutation } from "../../state";
import { Button, CheckCircle, Chips, cx, Field, TextArea, TextInput } from "../../ui";

const ESTIMATES = [15, 30, 60, 120, 240];

export function TaskForm({ item, defaults, onDone }: { item?: Task; defaults?: Partial<Pick<Task, "due_date" | "project_id">>; onDone: () => void }) {
  const { today, openSheet } = useApp();
  const { run, busy } = useMutation();
  const projects = (useData<Project[]>("/api/projects").data ?? []).filter((p) => p.status !== "done" || p.id === item?.project_id);
  const knownTags = useData<string[]>("/api/tasks/tags").data ?? [];
  const isSubtask = !!item?.parent_id;
  const subtasks = useData<Task[]>(item && !isSubtask ? `/api/tasks?status=all&parent_id=${item.id}` : null).data ?? [];
  const blocks = useData<CalendarEvent[]>(item ? `/api/events?task_id=${item.id}` : null).data ?? [];

  const [title, setTitle] = useState(item?.title ?? "");
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [due, setDue] = useState<string | null>(item ? item.due_date : (defaults?.due_date ?? null));
  const [priority, setPriority] = useState<TaskPriority>(item?.priority ?? "medium");
  const [status, setStatus] = useState<TaskStatus>(item?.status ?? "todo");
  const [projectId, setProjectId] = useState<number | null>(item ? item.project_id : (defaults?.project_id ?? null));
  const [estimate, setEstimate] = useState<number | null>(item?.estimate_minutes ?? null);
  const [tags, setTags] = useState((item?.tags ?? []).join(", "));
  const [pendingSubtasks, setPendingSubtasks] = useState<string[]>([]);
  const [subtaskDraft, setSubtaskDraft] = useState("");

  const tagList = tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const nextMonday = addDays(startOfWeek(today), 7);
  const body = { title, notes: notes.trim() || null, due_date: due, priority, project_id: projectId, estimate_minutes: estimate, tags: tagList };

  async function save() {
    if (!title.trim()) return;
    if (item) {
      if (await run(() => api.patch(`/api/tasks/${item.id}`, { ...body, status }), "Tarefa salva")) onDone();
      return;
    }
    const ok = await run(async () => {
      const created = await api.post<Task>("/api/tasks", body);
      for (const t of pendingSubtasks) await api.post("/api/tasks", { title: t, parent_id: created.id });
      return created;
    }, "Tarefa criada");
    if (ok) onDone();
  }

  async function remove() {
    if (!item) return;
    if (!confirmDelete(`a tarefa "${item.title}"${subtasks.length ? ` e as ${subtasks.length} subtarefas` : ""}`)) return;
    if (await run(() => api.del(`/api/tasks/${item.id}`), "Tarefa excluída")) onDone();
  }

  async function addSubtask() {
    const t = subtaskDraft.trim();
    if (!t) return;
    setSubtaskDraft("");
    if (item) await run(() => api.post("/api/tasks", { title: t, parent_id: item.id }));
    else setPendingSubtasks((s) => [...s, t]);
  }

  const onSubtaskKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void addSubtask();
    }
  };

  return (
    <div className="space-y-4">
      <Field label="Tarefa" htmlFor="task-title">
        <TextInput id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Renovar a CNH" autoFocus={!item} />
      </Field>

      <Field label="Prazo">
        <div className="space-y-2">
          <Chips<string | null>
            options={[
              { value: null, label: "Sem prazo" },
              { value: today, label: "Hoje" },
              { value: addDays(today, 1), label: "Amanhã" },
              // No domingo, a próxima segunda é amanhã: não repete a opção
              ...(nextMonday !== addDays(today, 1) ? [{ value: nextMonday, label: "Próx. segunda" }] : []),
            ]}
            value={due}
            onChange={setDue}
          />
          <TextInput type="date" aria-label="Data do prazo" value={due ?? ""} onChange={(e) => setDue(e.target.value || null)} />
        </div>
      </Field>

      <Field label="Prioridade">
        <Chips<TaskPriority>
          options={[
            { value: "low", label: "Baixa" },
            { value: "medium", label: "Média" },
            { value: "high", label: "Alta" },
          ]}
          value={priority}
          onChange={setPriority}
        />
      </Field>

      {item && (
        <Field label="Situação">
          <Chips<TaskStatus>
            options={[
              { value: "todo", label: "Pendente" },
              { value: "doing", label: "Em andamento" },
              { value: "done", label: "Concluída" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>
      )}

      {!isSubtask && projects.length > 0 && (
        <Field label="Projeto">
          <Chips<number | null> options={[{ value: null, label: "Nenhum" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} value={projectId} onChange={setProjectId} />
        </Field>
      )}

      <Field label="Tempo estimado">
        <Chips<number | null>
          options={[{ value: null, label: "—" }, ...ESTIMATES.map((m) => ({ value: m, label: m < 60 ? `${m} min` : `${m / 60} h` }))]}
          value={estimate}
          onChange={setEstimate}
        />
      </Field>

      {!isSubtask && (
        <Field label="Subtarefas">
          <div className="space-y-2">
            {subtasks.map((s) => (
              <SubtaskItem key={s.id} task={s} />
            ))}
            {pendingSubtasks.map((t, i) => (
              <div key={i} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[15px]">
                <span className="flex-1">{t}</span>
                <button type="button" aria-label={`Remover ${t}`} className="rounded-full p-1 text-muted hover:text-text" onClick={() => setPendingSubtasks((s) => s.filter((_, j) => j !== i))}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <TextInput value={subtaskDraft} onChange={(e) => setSubtaskDraft(e.target.value)} onKeyDown={onSubtaskKey} placeholder="Adicionar subtarefa" aria-label="Nova subtarefa" />
              <Button variant="secondary" onClick={() => void addSubtask()} disabled={!subtaskDraft.trim()}>
                Adicionar
              </Button>
            </div>
          </div>
        </Field>
      )}

      <Field label="Etiquetas" htmlFor="task-tags" hint="Separe por vírgula.">
        <TextInput id="task-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ex.: casa, banco" />
        {knownTags.filter((t) => !tagList.some((x) => x.toLowerCase() === t.toLowerCase())).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {knownTags
              .filter((t) => !tagList.some((x) => x.toLowerCase() === t.toLowerCase()))
              .slice(0, 8)
              .map((t) => (
                <button key={t} type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-muted hover:text-text" onClick={() => setTags([...tagList, t].join(", "))}>
                  #{t}
                </button>
              ))}
          </div>
        )}
      </Field>

      <Field label="Notas" htmlFor="task-notes">
        <TextArea id="task-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      {item && (
        <Field label="Horários reservados na agenda">
          <div className="space-y-2">
            {blocks.map((b) => (
              <p key={b.id} className="text-sm">
                {relativeDay(b.start_at.slice(0, 10), today)} · {timeLabel(b)}
              </p>
            ))}
            <Button variant="secondary" className="w-full" onClick={() => openSheet({ kind: "new", tab: "event", event: { taskId: item.id, title: item.title, date: due && due >= today ? due : today } })}>
              <CalendarPlus size={18} /> Reservar horário
            </Button>
          </div>
        </Field>
      )}

      <FormFooter onSave={save} busy={busy} disabled={!title.trim()} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Criar tarefa"} />
    </div>
  );
}

function SubtaskItem({ task }: { task: Task }) {
  const { run } = useMutation();
  const done = task.status === "done";
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <CheckCircle
        checked={done}
        label={done ? `Reabrir: ${task.title}` : `Concluir: ${task.title}`}
        onClick={() => run(() => api.patch(`/api/tasks/${task.id}`, { status: done ? "todo" : "done" }))}
      />
      <span className={cx("flex-1 text-[15px]", done && "text-muted line-through")}>{task.title}</span>
      <button
        type="button"
        aria-label={`Excluir ${task.title}`}
        className="rounded-full p-1 text-muted hover:text-danger"
        onClick={() => confirmDelete(`a subtarefa "${task.title}"`) && run(() => api.del(`/api/tasks/${task.id}`))}
      >
        <X size={16} />
      </button>
    </div>
  );
}
