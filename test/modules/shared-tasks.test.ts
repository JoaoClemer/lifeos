// Tarefas compartilhadas: listas (projetos) com membros e tarefas designadas a pessoas conectadas.
// Pessoa 1 é dona da lista "Casa"; pessoa 2 ("Ana", conectada) é membro; pessoa 3 não está conectada.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleMcpRequest } from "../../src/worker/mcp/server";
import { removeConnection } from "../../src/worker/modules/connections/service";
import * as tasks from "../../src/worker/modules/tasks/service";
import { testCtx, TODAY } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const owner = testCtx(env.DB);
const ana = testCtx(env.DB, TODAY, "10:00", 2);
const third = testCtx(env.DB, TODAY, "10:00", 3);

beforeEach(async () => {
  await resetLifeOS(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM project_members"),
    env.DB.prepare("DELETE FROM users WHERE id <> 1"),
    env.DB.prepare("UPDATE users SET name = 'Dono' WHERE id = 1"),
    env.DB.prepare("INSERT INTO users (id, name, role) VALUES (2, 'Ana Souza', 'member'), (3, 'Terceira', 'member')"),
    env.DB.prepare("INSERT INTO connections (user_a, user_b) VALUES (1, 2)"),
  ]);
});

async function sharedList() {
  const casa = await tasks.createProject(owner, { name: "Casa" });
  await tasks.setProjectMembers(owner, casa.id, [2]);
  return casa;
}

describe("lista compartilhada", () => {
  it("membros veem a lista e as tarefas, criam, editam e concluem; só quem criou ou o dono exclui", async () => {
    const casa = await sharedList();
    const lampada = await tasks.createTask(owner, { title: "Trocar lâmpada", project_id: casa.id, due_date: TODAY });
    const projectsOfAna = await tasks.listProjects(ana);
    expect(projectsOfAna).toMatchObject([{ id: casa.id, name: "Casa", owner: { id: 1, name: "Dono" }, members: 1, open_count: 1 }]);
    expect((await tasks.listProjects(owner))[0]).toMatchObject({ owner: null, members: 1 });

    const seen = await tasks.getTask(ana, lampada.id);
    expect(seen).toMatchObject({ owner: { id: 1, name: "Dono" }, can_delete: false });
    // Aparece no "hoje" de quem participa (tarefa da lista sem ninguém designado)
    expect((await tasks.listTasks(ana, { due_to: TODAY })).map((t) => t.title)).toEqual(["Trocar lâmpada"]);

    const mercado = await tasks.createTask(ana, { title: "Mercado", project_id: casa.id });
    expect((await tasks.listTasks(owner, { project_id: casa.id })).map((t) => t.title).sort()).toEqual(["Mercado", "Trocar lâmpada"]);
    expect((await tasks.getTask(owner, mercado.id)).can_delete).toBe(true); // dono da lista

    await tasks.updateTask(ana, lampada.id, { title: "Trocar lâmpada da sala", status: "done" });
    expect(await tasks.getTask(owner, lampada.id)).toMatchObject({ title: "Trocar lâmpada da sala", status: "done" });
    await expect(tasks.deleteTask(ana, lampada.id)).rejects.toThrow("Só quem criou");
    await tasks.deleteTask(ana, mercado.id);
  });

  it("só o dono altera a lista e os membros; quem participa pode sair; quem não está conectado não entra", async () => {
    const casa = await sharedList();
    await expect(tasks.updateProject(ana, casa.id, { name: "Minha" })).rejects.toThrow("Só Dono");
    await expect(tasks.setProjectMembers(ana, casa.id, [])).rejects.toThrow("Só Dono");
    await expect(tasks.deleteProject(ana, casa.id)).rejects.toThrow("Só Dono");
    await expect(tasks.setProjectMembers(owner, casa.id, [3])).rejects.toThrow("conectadas");
    expect((await tasks.listProjectMembers(ana, casa.id)).map((m) => [m.name, m.role])).toEqual([
      ["Dono", "owner"],
      ["Ana Souza", "member"],
    ]);

    const minha = await tasks.createTask(ana, { title: "Tarefa dela na lista", project_id: casa.id });
    await tasks.leaveProject(ana, casa.id);
    expect(await tasks.listProjects(ana)).toEqual([]);
    // O que ela criou continua dela; o resto da lista some
    expect((await tasks.listTasks(ana, { status: "all" })).map((t) => t.id)).toEqual([minha.id]);
    await expect(tasks.listProjectMembers(ana, casa.id)).rejects.toThrow("não encontrado");
  });

  it("subtarefas e a próxima de uma tarefa que se repete continuam na lista", async () => {
    const casa = await sharedList();
    const lixo = await tasks.createTask(owner, { title: "Tirar o lixo", project_id: casa.id, due_date: TODAY, rrule: "FREQ=WEEKLY;BYDAY=TH" });
    const sub = await tasks.createTask(ana, { title: "Reciclável", parent_id: lixo.id });
    expect(await tasks.getTask(owner, sub.id)).toMatchObject({ project_id: casa.id, owner: null });
    await tasks.updateTask(ana, lixo.id, { status: "done" });
    const next = await tasks.getSuccessor(ana, lixo.id);
    expect(next).toMatchObject({ project_id: casa.id, subtasks_total: 1, status: "todo" });
  });
});

describe("tarefa designada", () => {
  it("a pessoa designada vê e conclui; só dá para designar a pessoas conectadas", async () => {
    const t = await tasks.createTask(owner, { title: "Buscar o carro", assignee_user_id: 2, due_date: TODAY });
    expect(await tasks.getTask(ana, t.id)).toMatchObject({ owner: { id: 1 }, assignee: { id: 2, name: "Ana Souza" } });
    expect((await tasks.listTasks(ana)).map((x) => x.title)).toEqual(["Buscar o carro"]);
    // Quem delegou continua vendo na lista dele
    expect((await tasks.listTasks(owner)).map((x) => x.title)).toEqual(["Buscar o carro"]);
    await tasks.updateTask(ana, t.id, { status: "done" });
    expect((await tasks.getTask(owner, t.id)).status).toBe("done");
    await expect(tasks.createTask(owner, { title: "x", assignee_user_id: 3 })).rejects.toThrow("conectadas");
    await expect(tasks.getTask(third, t.id)).rejects.toThrow("não encontrada");
  });

  it("numa lista compartilhada, tarefas designadas a outra pessoa saem das listas gerais de quem não é o dono", async () => {
    const casa = await sharedList();
    await tasks.createTask(owner, { title: "Só minha", project_id: casa.id, assignee_user_id: 1 });
    expect(await tasks.listTasks(ana)).toEqual([]);
    expect((await tasks.listTasks(ana, { project_id: casa.id })).map((t) => t.title)).toEqual(["Só minha"]);
  });

  it("desconectar tira a pessoa da lista e das tarefas designadas", async () => {
    const casa = await sharedList();
    const t = await tasks.createTask(owner, { title: "Buscar o carro", assignee_user_id: 2 });
    await removeConnection(owner, 2);
    expect(await tasks.listProjects(ana)).toEqual([]);
    await expect(tasks.getTask(ana, t.id)).rejects.toThrow("não encontrada");
    expect((await tasks.getTask(owner, t.id)).assignee).toBeNull();
    expect((await tasks.listProjectMembers(owner, casa.id)).length).toBe(1);
  });
});

describe("pelo MCP", () => {
  const mcp = async (userId: number, name: string, args: Record<string, unknown>) => {
    const req = new Request("http://test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const { result } = (await (await handleMcpRequest(req, env, userId)).json()) as { result: { content: { text: string }[] } };
    return result.content[0].text;
  };

  it("compartilha a lista, cria tarefa designada e a outra pessoa vê quem pediu", async () => {
    await mcp(1, "criar_projeto", { nome: "Casa" });
    expect(await mcp(1, "compartilhar_projeto", { projeto: "Casa", adicionar: ["Ana Souza"] })).toContain("compartilhada com: Ana Souza");
    expect(await mcp(1, "criar_tarefa", { titulo: "Pagar a luz", projeto: "Casa", atribuir_a: "Ana Souza" })).toContain("para Ana Souza");
    const list = await mcp(2, "listar_tarefas", { filtro: "abertas" });
    expect(list).toContain("Pagar a luz");
    expect(list).toContain("de Dono");
    expect(await mcp(2, "concluir_tarefa", { tarefa: "Pagar a luz" })).toContain("Tarefa concluída");
    expect(await mcp(2, "compartilhar_projeto", { projeto: "Casa", sair: true })).toContain("saiu da lista");
  });
});
