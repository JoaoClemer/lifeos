import { useState } from "react";
import type { Project, ProjectStatus } from "../../../shared/tasks";
import { api } from "../../api";
import { confirmDelete, FormFooter } from "../../forms/common";
import { useMutation } from "../../state";
import { Chips, Field, TextArea, TextInput } from "../../ui";

export function ProjectForm({ item, onDone }: { item?: Project; onDone: () => void }) {
  const { run, busy } = useMutation();
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(item?.status ?? "active");
  const [due, setDue] = useState(item?.due_date ?? "");

  async function save() {
    if (!name.trim()) return;
    const body = { name, description: description.trim() || null, status, due_date: due || null };
    const ok = item
      ? await run(() => api.patch(`/api/projects/${item.id}`, body), "Projeto salvo")
      : await run(() => api.post("/api/projects", body), "Projeto criado");
    if (ok) onDone();
  }

  async function remove() {
    if (!item) return;
    if (!confirmDelete(`o projeto "${item.name}"? As tarefas continuam, sem projeto. Para guardar o histórico, prefira "Arquivado"`)) return;
    if (await run(() => api.del(`/api/projects/${item.id}`), "Projeto excluído")) onDone();
  }

  return (
    <div className="space-y-4">
      <Field label="Nome" htmlFor="project-name">
        <TextInput id="project-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Reforma da cozinha" autoFocus={!item} />
      </Field>
      <Field label="Prazo (opcional)" htmlFor="project-due">
        <TextInput id="project-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      </Field>
      {item && (
        <Field label="Situação">
          <Chips<ProjectStatus>
            options={[
              { value: "active", label: "Ativo" },
              { value: "paused", label: "Pausado" },
              { value: "done", label: "Concluído" },
              { value: "archived", label: "Arquivado" },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>
      )}
      <Field label="Descrição" htmlFor="project-desc">
        <TextArea id="project-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <FormFooter onSave={save} busy={busy} disabled={!name.trim()} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Criar projeto"} />
    </div>
  );
}
