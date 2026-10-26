import { LogOut } from "lucide-react";
import { useEffect, useState } from "react";
import type { Project, ProjectMember, ProjectStatus } from "../../../shared/tasks";
import { api } from "../../api";
import { confirmDelete, FormFooter } from "../../forms/common";
import { PeoplePicker } from "../../PeoplePicker";
import { useData, useMutation } from "../../state";
import { Button, Chips, Field, TextArea, TextInput } from "../../ui";

export function ProjectForm({ item, onDone }: { item?: Project; onDone: () => void }) {
  const { run, busy } = useMutation();
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [status, setStatus] = useState<ProjectStatus>(item?.status ?? "active");
  const [due, setDue] = useState(item?.due_date ?? "");
  // Compartilhar a lista com pessoas conectadas (só o dono)
  const members = useData<ProjectMember[]>(item ? `/api/projects/${item.id}/members` : null).data;
  const [people, setPeople] = useState<number[] | null>(item ? null : []);
  useEffect(() => {
    if (members && people === null) setPeople(members.filter((m) => m.role === "member").map((m) => m.id));
  }, [members, people]);

  // Lista de outra pessoa: só mostra de quem é e quem participa, com a opção de sair
  if (item?.owner) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Lista de <b className="text-text">{item.owner.name ?? "pessoa conectada"}</b>, compartilhada com você. Você vê e edita as tarefas dela; só{" "}
          {item.owner.name ?? "o dono"} altera a lista.
        </p>
        {members && <p className="text-sm">Participam: {members.map((m) => m.name ?? "pessoa").join(", ")}</p>}
        <Button
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={async () =>
            window.confirm(`Sair da lista "${item.name}"? As tarefas que você criou nela continuam suas.`) &&
            (await run(() => api.post(`/api/projects/${item.id}/leave`), "Você saiu da lista")) &&
            onDone()
          }
        >
          <LogOut size={16} /> Sair da lista
        </Button>
      </div>
    );
  }

  async function save() {
    if (!name.trim()) return;
    const body = { name, description: description.trim() || null, status, due_date: due || null };
    const ok = await run(async () => {
      const p = item ? await api.patch<Project>(`/api/projects/${item.id}`, body) : await api.post<Project>("/api/projects", body);
      const before = (members ?? []).filter((m) => m.role === "member").map((m) => m.id);
      if (people && JSON.stringify([...people].sort()) !== JSON.stringify([...before].sort())) {
        await api.put(`/api/projects/${p.id}/members`, { user_ids: people });
      }
      return p;
    }, item ? "Projeto salvo" : "Projeto criado");
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
      <Field label="Compartilhar com" hint="Quem participa vê e edita as tarefas da lista (útil para listas da casa, de viagem…).">
        {people === null ? <div className="h-8 animate-pulse rounded-full bg-surface-2" /> : <PeoplePicker value={people} onChange={setPeople} />}
      </Field>
      <Field label="Descrição" htmlFor="project-desc">
        <TextArea id="project-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <FormFooter onSave={save} busy={busy} disabled={!name.trim()} onDelete={item ? remove : undefined} saveLabel={item ? "Salvar" : "Criar projeto"} />
    </div>
  );
}
