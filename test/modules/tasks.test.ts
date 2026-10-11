import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createEvent, getEvent } from "../../src/worker/modules/agenda/service";
import {
  createProject,
  createTask,
  deleteProject,
  deleteTask,
  getTask,
  listProjects,
  listTags,
  listTasks,
  resolveTask,
  updateTask,
} from "../../src/worker/modules/tasks/service";
import { testCtx } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const ctx = testCtx(env.DB, "2026-10-15", "09:30");

beforeEach(() => resetLifeOS(env.DB));

async function log(entityId: number) {
  return (await env.DB.prepare("SELECT action, source FROM activity_log WHERE entity = 'task' AND entity_id = ? ORDER BY id").bind(entityId).all()).results;
}

describe("tarefas", () => {
  it("cria com padrões e sem prazo", async () => {
    const t = await createTask(ctx, { title: "  Ligar para o banco  " });
    expect(t).toMatchObject({ title: "Ligar para o banco", status: "todo", priority: "medium", due_date: null, tags: [], completed_at: null, subtasks_total: 0 });
  });

  it("valida data, projeto e nível das subtarefas", async () => {
    await expect(createTask(ctx, { title: "X", due_date: "2026-02-30" })).rejects.toThrow("data inválida");
    await expect(createTask(ctx, { title: "X", project_id: 999 })).rejects.toThrow("Projeto 999 não encontrado");
    const parent = await createTask(ctx, { title: "Mudança" });
    const child = await createTask(ctx, { title: "Caixas", parent_id: parent.id });
    await expect(createTask(ctx, { title: "Neto", parent_id: child.id })).rejects.toThrow("um nível só");
    await expect(updateTask(ctx, parent.id, { parent_id: (await createTask(ctx, { title: "Outra" })).id })).rejects.toThrow("tem subtarefas");
    await expect(updateTask(ctx, parent.id, { parent_id: parent.id })).rejects.toThrow("dela mesma");
  });

  it("etiquetas sem repetição e filtro por etiqueta", async () => {
    const t = await createTask(ctx, { title: "Pagar IPVA", tags: ["Carro", "carro", "banco"] });
    expect(t.tags).toEqual(["Carro", "banco"]);
    await createTask(ctx, { title: "Outra", tags: ["casa"] });
    expect((await listTasks(ctx, { tag: "CARRO" })).map((x) => x.title)).toEqual(["Pagar IPVA"]);
    expect(await listTags(ctx)).toEqual(expect.arrayContaining(["Carro", "banco", "casa"]));
  });

  it("ordem: prazo mais cedo primeiro, depois prioridade; sem prazo por último; subtarefas fora da lista principal", async () => {
    const sem = await createTask(ctx, { title: "Sem prazo", priority: "high" });
    const baixa = await createTask(ctx, { title: "Hoje baixa", priority: "low", due_date: "2026-10-15" });
    const alta = await createTask(ctx, { title: "Hoje alta", priority: "high", due_date: "2026-10-15" });
    const atrasada = await createTask(ctx, { title: "Atrasada", due_date: "2026-10-10" });
    await createTask(ctx, { title: "Sub", parent_id: sem.id, due_date: "2026-10-01" });
    expect((await listTasks(ctx)).map((t) => t.id)).toEqual([atrasada.id, alta.id, baixa.id, sem.id]);
    expect(await getTask(ctx, sem.id)).toMatchObject({ subtasks_total: 1, subtasks_done: 0 });
  });

  it("concluir grava a data e hora, conclui as subtarefas e fica no histórico; reabrir limpa a conclusão", async () => {
    const t = await createTask(ctx, { title: "Relatório" });
    const s1 = await createTask(ctx, { title: "Rascunho", parent_id: t.id });
    await createTask(ctx, { title: "Revisão", parent_id: t.id });
    await updateTask(ctx, s1.id, { status: "done" });

    const done = await updateTask(ctx, t.id, { status: "done" });
    expect(done).toMatchObject({ status: "done", completed_at: "2026-10-15T09:30", subtasks_done: 2 });
    expect((await listTasks(ctx, { status: "done" })).map((x) => x.id)).toContain(t.id);

    const later = testCtx(env.DB, "2026-10-16", "08:00");
    const reopened = await updateTask(later, t.id, { status: "doing" });
    expect(reopened).toMatchObject({ status: "doing", completed_at: null });
    expect(reopened.subtasks_done).toBe(2); // reabrir a tarefa não reabre as subtarefas
    expect(await log(t.id)).toEqual([
      { action: "task.completed", source: "app" },
      { action: "task.reopened", source: "app" },
    ]);
    // Mudar entre pendente e em andamento não gera histórico
    await updateTask(later, t.id, { status: "todo" });
    expect(await log(t.id)).toHaveLength(2);
  });

  it("concluir duas vezes não muda a data da primeira conclusão", async () => {
    const t = await createTask(ctx, { title: "Pagar boleto" });
    await updateTask(ctx, t.id, { status: "done" });
    await updateTask(testCtx(env.DB, "2026-10-20"), t.id, { status: "done" });
    expect((await getTask(ctx, t.id)).completed_at).toBe("2026-10-15T09:30");
    expect(await log(t.id)).toHaveLength(1);
  });

  it("excluir remove as subtarefas e mantém o horário reservado como evento comum", async () => {
    const t = await createTask(ctx, { title: "Estudar" });
    const sub = await createTask(ctx, { title: "Capítulo 1", parent_id: t.id });
    const block = await createEvent(ctx, { title: "Estudar", start: "2026-10-16T14:00", end: "2026-10-16T15:00", task_id: t.id });
    await deleteTask(ctx, t.id);
    await expect(getTask(ctx, sub.id)).rejects.toThrow("não encontrada");
    expect((await getEvent(ctx, block.id)).task_id).toBeNull();
    expect(await log(t.id)).toEqual([{ action: "task.deleted", source: "app" }]);
  });

  it("resolveTask encontra pelo título sem acento e avisa quando é ambíguo", async () => {
    await createTask(ctx, { title: "Revisão do carro" });
    await createTask(ctx, { title: "Revisão do contrato" });
    expect((await resolveTask(ctx, "revisao do carro")).title).toBe("Revisão do carro");
    await expect(resolveTask(ctx, "revisao")).rejects.toThrow("ambíguo");
  });
});

describe("projetos", () => {
  it("contam tarefas abertas e concluídas; excluir o projeto mantém as tarefas", async () => {
    const p = await createProject(ctx, { name: "Casa nova" });
    const a = await createTask(ctx, { title: "Pintura", project_id: p.id });
    await createTask(ctx, { title: "Mudança", project_id: p.id });
    await updateTask(ctx, a.id, { status: "done" });
    expect(await listProjects(ctx)).toEqual([expect.objectContaining({ name: "Casa nova", open_count: 1, done_count: 1 })]);
    expect((await listTasks(ctx, { project_id: p.id })).map((t) => t.title)).toEqual(["Mudança"]);
    await deleteProject(ctx, p.id);
    expect((await getTask(ctx, a.id)).project_id).toBeNull();
  });
});
