// Agenda compartilhada: quem cria convida pessoas conectadas; o convidado vê na agenda dele, aceita ou recusa,
// mas não altera. Pessoa 1 cria, pessoa 2 ("Ana", conectada) é convidada, pessoa 3 não está conectada.
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { handleMcpRequest } from "../../src/worker/mcp/server";
import * as agenda from "../../src/worker/modules/agenda/service";
import { getAgenda } from "../../src/worker/modules/today/service";
import { createTask } from "../../src/worker/modules/tasks/service";
import { testCtx, TODAY } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const owner = testCtx(env.DB);
const ana = testCtx(env.DB, TODAY, "10:00", 2);
const third = testCtx(env.DB, TODAY, "10:00", 3);

beforeEach(async () => {
  await resetLifeOS(env.DB);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM users WHERE id <> 1"),
    env.DB.prepare("UPDATE users SET name = 'Dono' WHERE id = 1"),
    env.DB.prepare("INSERT INTO users (id, name, role) VALUES (2, 'Ana Souza', 'member'), (3, 'Terceira', 'member')"),
    env.DB.prepare("INSERT INTO connections (user_a, user_b) VALUES (1, 2)"),
  ]);
});

const week = (ctx: typeof owner) => agenda.listOccurrences(ctx, "2026-10-12", "2026-10-25");

describe("convidar para um evento", () => {
  it("o convidado vê o evento com o convite, sem a tarefa de quem criou; aceita, e recusar tira da agenda", async () => {
    const task = await createTask(owner, { title: "Tarefa privada" });
    const e = await agenda.createEvent(owner, { title: "Jantar", start: "2026-10-16T20:00", participants: [2], task_id: task.id, location: "Casa" });
    const [mine] = await week(owner);
    expect(mine).toMatchObject({ event_id: e.id, participants: 1, invite: null, task_id: task.id });

    const [invited] = await week(ana);
    expect(invited).toMatchObject({ event_id: e.id, title: "Jantar", location: "Casa", task_id: null, invite: { owner_id: 1, owner_name: "Dono", status: "invited" } });
    expect(await week(third)).toEqual([]);

    await agenda.respondInvite(ana, e.id, "accepted");
    expect((await week(ana))[0].invite?.status).toBe("accepted");
    expect(await agenda.listParticipants(owner, e.id)).toEqual([{ user_id: 2, name: "Ana Souza", status: "accepted" }]);

    await agenda.respondInvite(ana, e.id, "declined");
    expect(await week(ana)).toEqual([]);
    expect((await week(owner))[0].participants).toBe(0);
  });

  it("só pessoas conectadas podem ser convidadas; o convidado não edita, não exclui nem vê os convidados", async () => {
    await expect(agenda.createEvent(owner, { title: "X", start: "2026-10-16T20:00", participants: [3] })).rejects.toThrow("conectadas");
    const e = await agenda.createEvent(owner, { title: "Jantar", start: "2026-10-16T20:00", participants: [2] });
    await expect(agenda.updateEvent(ana, e.id, { title: "Hackeado" })).rejects.toThrow("não encontrado");
    await expect(agenda.deleteEvent(ana, e.id)).rejects.toThrow("não encontrado");
    await expect(agenda.listParticipants(ana, e.id)).rejects.toThrow("não encontrado");
    await expect(agenda.respondInvite(third, e.id, "accepted")).rejects.toThrow("não encontrado");
  });

  it("quem criou altera os convidados; quem sai deixa de ver; excluir o evento tira de todos", async () => {
    const e = await agenda.createEvent(owner, { title: "Jantar", start: "2026-10-16T20:00", participants: [2] });
    await agenda.respondInvite(ana, e.id, "accepted");
    await agenda.updateEvent(owner, e.id, { title: "Jantar de aniversário" });
    expect((await week(ana))[0]).toMatchObject({ title: "Jantar de aniversário", invite: { status: "accepted" } });

    await agenda.updateEvent(owner, e.id, { participants: [] });
    expect(await week(ana)).toEqual([]);
    await agenda.updateEvent(owner, e.id, { participants: [2] });
    expect((await week(ana))[0].invite?.status).toBe("invited");

    await agenda.deleteEvent(owner, e.id);
    expect(await week(ana)).toEqual([]);
  });
});

describe("séries", () => {
  it("o convite vale para a série; ocorrência movida aparece no horário novo e a cancelada some para o convidado", async () => {
    // Toda quinta às 19h, a partir de 01/10/2026
    const s = await agenda.createEvent(owner, { title: "Vôlei", start: "2026-10-01T19:00", rrule: "FREQ=WEEKLY;BYDAY=TH", participants: [2] });
    await agenda.updateEvent(owner, s.id, { start: "2026-10-15T20:00" }, { scope: "this", occurrence_start: "2026-10-15T19:00" });
    await agenda.deleteEvent(owner, s.id, { scope: "this", occurrence_start: "2026-10-22T19:00" });
    const seen = (await week(ana)).map((o) => [o.start_at, o.invite?.owner_name]);
    expect(seen).toEqual([["2026-10-15T20:00", "Dono"]]);
  });

  it("dividir a série (esta e as seguintes) leva os convidados e as respostas", async () => {
    const s = await agenda.createEvent(owner, { title: "Vôlei", start: "2026-10-01T19:00", rrule: "FREQ=WEEKLY;BYDAY=TH", participants: [2] });
    await agenda.respondInvite(ana, s.id, "accepted");
    const next = await agenda.updateEvent(owner, s.id, { start: "2026-10-15T21:00" }, { scope: "following", occurrence_start: "2026-10-15T19:00" });
    expect(next.id).not.toBe(s.id);
    expect(await agenda.listParticipants(owner, next.id)).toEqual([{ user_id: 2, name: "Ana Souza", status: "accepted" }]);
    expect((await week(ana)).map((o) => [o.event_id, o.start_at])).toEqual([
      [next.id, "2026-10-15T21:00"],
      [next.id, "2026-10-22T21:00"],
    ]);
  });
});

describe("Hoje e MCP", () => {
  const mcp = async (userId: number, name: string, args: Record<string, unknown>) => {
    const req = new Request("http://test/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
    });
    const { result } = (await (await handleMcpRequest(req, env, userId)).json()) as { result: { content: { text: string }[] } };
    return result.content[0].text;
  };

  it("o evento compartilhado entra na agenda do dia do convidado", async () => {
    await agenda.createEvent(owner, { title: "Jantar", start: "2026-10-15T20:00", participants: [2] });
    const items = await getAgenda(ana, TODAY, TODAY);
    expect(items.map((i) => (i.kind === "event" ? [i.title, i.invite?.owner_name] : i.kind))).toEqual([["Jantar", "Dono"]]);
  });

  it("criar com convidados, ver o convite na agenda e responder", async () => {
    const created = await mcp(1, "criar_evento", { titulo: "Churrasco", data: "2026-10-17", hora_inicio: "13:00", convidar: ["Ana Souza"] });
    expect(created).toContain("convidados: Ana Souza");
    const id = Number(/\[evento (\d+)\]/.exec(created)![1]);
    expect(await mcp(2, "agenda", { de: "2026-10-17", ate: "2026-10-17" })).toContain("convite de Dono (ainda não respondido");
    expect(await mcp(2, "responder_convite", { evento: id, resposta: "aceitar" })).toContain("Convite aceito");
    expect(await mcp(1, "agenda", { de: "2026-10-17", ate: "2026-10-17" })).toContain("1 convidado(s)");
    expect(await mcp(1, "editar_evento", { evento: id, desconvidar: ["Ana Souza"] })).toContain("Evento atualizado");
    expect(await mcp(2, "agenda", { de: "2026-10-17", ate: "2026-10-17" })).not.toContain("Churrasco");
  });
});
