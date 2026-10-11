import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createEvent, deleteEvent, getEvent, listOccurrences, updateEvent } from "../../src/worker/modules/agenda/service";
import { createTask, updateTask } from "../../src/worker/modules/tasks/service";
import { getAgenda, getToday } from "../../src/worker/modules/today/service";
import { testCtx } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

const ctx = testCtx(env.DB, "2026-10-15", "09:30");

beforeEach(() => resetLifeOS(env.DB));

const starts = async (from: string, to: string) => (await listOccurrences(ctx, from, to)).map((o) => `${o.start_at} ${o.title}`);
const rows = async () => (await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>())!.n;

describe("criar e validar", () => {
  it("evento com horário: fim padrão 1 hora depois", async () => {
    const e = await createEvent(ctx, { title: "Dentista", start: "2026-10-20T14:00", location: "Centro", url: "" });
    expect(e).toMatchObject({ all_day: false, start_at: "2026-10-20T14:00", end_at: "2026-10-20T15:00", timezone: "America/Sao_Paulo", url: null });
  });

  it("dia inteiro de vários dias: fim exclusivo no dia seguinte ao último", async () => {
    const e = await createEvent(ctx, { title: "Viagem", all_day: true, start: "2026-10-20", end: "2026-10-22" });
    expect(e).toMatchObject({ all_day: true, start_at: "2026-10-20T00:00", end_at: "2026-10-23T00:00" });
    expect(await starts("2026-10-22", "2026-10-22")).toEqual(["2026-10-20T00:00 Viagem"]);
    expect(await starts("2026-10-23", "2026-10-23")).toEqual([]);
  });

  it.each([
    [{ start: "2026-10-20T14:00", end: "2026-10-20T13:00" }, "depois do início"],
    [{ start: "2026-10-20" }, "informe data e horário"],
    [{ start: "2026-02-30T10:00" }, "Início inválido"],
    [{ all_day: true, start: "2026-10-20", end: "2026-10-19" }, "antes do primeiro"],
    [{ start: "2018-11-04T00:30" }, "não existe no fuso"],
    [{ start: "2026-10-20T10:00", url: "javascript:alert(1)" }, "link inválido"],
    [{ start: "2026-10-20T10:00", rrule: "FREQ=HOURLY" }, "FREQ"],
  ])("recusa %j", async (input, message) => {
    await expect(createEvent(ctx, { title: "X", ...input })).rejects.toThrow(message);
  });

  it("o evento pode reservar horário para uma tarefa existente", async () => {
    await expect(createEvent(ctx, { title: "X", start: "2026-10-20T10:00", task_id: 999 })).rejects.toThrow("Tarefa 999");
  });
});

describe("intervalos e séries", () => {
  it("pega eventos que começaram antes e terminam dentro do intervalo, em ordem e com os de dia inteiro primeiro", async () => {
    await createEvent(ctx, { title: "Plantão", start: "2026-10-19T22:00", end: "2026-10-20T06:00" });
    await createEvent(ctx, { title: "Feriado", all_day: true, start: "2026-10-20" });
    await createEvent(ctx, { title: "Almoço", start: "2026-10-20T12:00" });
    expect(await starts("2026-10-20", "2026-10-20")).toEqual(["2026-10-19T22:00 Plantão", "2026-10-20T00:00 Feriado", "2026-10-20T12:00 Almoço"]);
  });

  it("série semanal: ocorrências calculadas, sem gravar uma linha por ocorrência", async () => {
    await createEvent(ctx, { title: "Inglês", start: "2026-10-05T19:00", end: "2026-10-05T20:30", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" });
    expect(await starts("2026-10-12", "2026-10-18")).toEqual(["2026-10-12T19:00 Inglês", "2026-10-14T19:00 Inglês"]);
    expect(await rows()).toBe(1);
    const [o] = await listOccurrences(ctx, "2026-10-12", "2026-10-12");
    expect(o).toMatchObject({ occurrence_start: "2026-10-12T19:00", end_at: "2026-10-12T20:30", modified: false, rrule: "FREQ=WEEKLY;BYDAY=MO,WE" });
  });
});

describe("alterar e excluir ocorrências", () => {
  async function weekly() {
    return createEvent(ctx, { title: "Corrida", start: "2026-10-05T07:00", rrule: "FREQ=WEEKLY;BYDAY=MO" });
  }

  it("série exige o escopo e uma ocorrência que exista", async () => {
    const s = await weekly();
    await expect(updateEvent(ctx, s.id, { title: "X" }, { occurrence_start: "2026-10-12T07:00" })).rejects.toThrow("informe se a mudança");
    await expect(updateEvent(ctx, s.id, { title: "X" }, { scope: "this", occurrence_start: "2026-10-13T07:00" })).rejects.toThrow("não é uma ocorrência");
  });

  it("só esta: editar a mesma ocorrência duas vezes não duplica", async () => {
    const s = await weekly();
    const scope = { scope: "this" as const, occurrence_start: "2026-10-12T07:00" };
    await updateEvent(ctx, s.id, { start: "2026-10-12T08:00" }, scope);
    const again = await updateEvent(ctx, s.id, { title: "Corrida longa" }, scope);
    expect(again).toMatchObject({ series_id: s.id, original_start: "2026-10-12T07:00", start_at: "2026-10-12T08:00", end_at: "2026-10-12T09:00" });
    expect(await rows()).toBe(2);
    expect(await starts("2026-10-05", "2026-10-19")).toEqual(["2026-10-05T07:00 Corrida", "2026-10-12T08:00 Corrida longa", "2026-10-19T07:00 Corrida"]);
    // Editar de novo pelo id da ocorrência alterada também atualiza a mesma linha
    await updateEvent(ctx, again.id, { location: "Parque" }, { scope: "this" });
    expect(await rows()).toBe(2);
    expect((await listOccurrences(ctx, "2026-10-12", "2026-10-12"))[0]).toMatchObject({ location: "Parque", modified: true, event_id: s.id });
  });

  it("só esta: excluir cancela a ocorrência", async () => {
    const s = await weekly();
    await deleteEvent(ctx, s.id, { scope: "this", occurrence_start: "2026-10-12T07:00" });
    expect(await starts("2026-10-05", "2026-10-19")).toEqual(["2026-10-05T07:00 Corrida", "2026-10-19T07:00 Corrida"]);
  });

  it("esta e as seguintes: divide a série, mantendo as anteriores como estavam", async () => {
    const s = await weekly();
    await updateEvent(ctx, s.id, { title: "Treino" }, { scope: "this", occurrence_start: "2026-10-26T07:00" }); // alteração futura, mesmo horário
    const next = await updateEvent(ctx, s.id, { start: "2026-10-19T06:30" }, { scope: "following", occurrence_start: "2026-10-19T07:00" });
    expect(next).toMatchObject({ start_at: "2026-10-19T06:30", rrule: "FREQ=WEEKLY;BYDAY=MO" });
    expect((await getEvent(ctx, s.id)).rrule).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261018");
    // O horário mudou: a alteração individual de 26/10 foi descartada
    expect(await starts("2026-10-05", "2026-11-02")).toEqual([
      "2026-10-05T07:00 Corrida",
      "2026-10-12T07:00 Corrida",
      "2026-10-19T06:30 Corrida",
      "2026-10-26T06:30 Corrida",
      "2026-11-02T06:30 Corrida",
    ]);
  });

  it("esta e as seguintes sem mudar o horário: as alterações individuais seguem para a nova série", async () => {
    const s = await weekly();
    await updateEvent(ctx, s.id, { title: "Prova" }, { scope: "this", occurrence_start: "2026-10-26T07:00" });
    await updateEvent(ctx, s.id, { location: "Pista" }, { scope: "following", occurrence_start: "2026-10-19T07:00" });
    const occ = await listOccurrences(ctx, "2026-10-19", "2026-10-26");
    expect(occ.map((o) => [o.title, o.location])).toEqual([
      ["Corrida", "Pista"],
      ["Prova", null],
    ]);
    expect(occ[0].event_id).toBe(occ[1].event_id); // as duas pertencem à nova série
  });

  it("esta e as seguintes com quantidade: divide o COUNT entre as duas partes", async () => {
    const s = await createEvent(ctx, { title: "Fisioterapia", start: "2026-10-05T18:00", rrule: "FREQ=WEEKLY;COUNT=6" });
    const next = await updateEvent(ctx, s.id, { title: "Fisio" }, { scope: "following", occurrence_start: "2026-10-19T18:00" });
    expect((await getEvent(ctx, s.id)).rrule).toBe("FREQ=WEEKLY;COUNT=2");
    expect(next.rrule).toBe("FREQ=WEEKLY;COUNT=4");
    expect((await listOccurrences(ctx, "2026-10-01", "2026-12-31")).map((o) => o.title)).toEqual(["Fisioterapia", "Fisioterapia", "Fisio", "Fisio", "Fisio", "Fisio"]);
  });

  it("todas: mudar o horário a partir de uma ocorrência desloca a série inteira e descarta alterações individuais", async () => {
    const s = await weekly();
    await updateEvent(ctx, s.id, { title: "Especial" }, { scope: "this", occurrence_start: "2026-10-12T07:00" });
    await updateEvent(ctx, s.id, { start: "2026-10-19T06:00" }, { scope: "all", occurrence_start: "2026-10-19T07:00" });
    expect(await getEvent(ctx, s.id)).toMatchObject({ start_at: "2026-10-05T06:00", end_at: "2026-10-05T07:00" });
    expect(await starts("2026-10-05", "2026-10-12")).toEqual(["2026-10-05T06:00 Corrida", "2026-10-12T06:00 Corrida"]);
    expect(await rows()).toBe(1);
  });

  it("todas sem mudar horário mantém as alterações individuais", async () => {
    const s = await weekly();
    await updateEvent(ctx, s.id, { title: "Especial" }, { scope: "this", occurrence_start: "2026-10-12T07:00" });
    await updateEvent(ctx, s.id, { location: "Orla" }, { scope: "all", occurrence_start: "2026-10-19T07:00" });
    expect(await starts("2026-10-05", "2026-10-12")).toEqual(["2026-10-05T07:00 Corrida", "2026-10-12T07:00 Especial"]);
  });

  it("excluir esta e as seguintes encerra a série; a partir da primeira, exclui tudo", async () => {
    const s = await weekly();
    await deleteEvent(ctx, s.id, { scope: "following", occurrence_start: "2026-10-19T07:00" });
    expect(await starts("2026-10-01", "2026-11-30")).toEqual(["2026-10-05T07:00 Corrida", "2026-10-12T07:00 Corrida"]);
    await deleteEvent(ctx, s.id, { scope: "following", occurrence_start: "2026-10-05T07:00" });
    expect(await rows()).toBe(0);
  });

  it("evento único ignora o escopo e pode virar série", async () => {
    const e = await createEvent(ctx, { title: "Reunião", start: "2026-10-16T10:00" });
    await updateEvent(ctx, e.id, { rrule: "FREQ=WEEKLY", start: "2026-10-16T11:00" });
    expect(await starts("2026-10-16", "2026-10-23")).toEqual(["2026-10-16T11:00 Reunião", "2026-10-23T11:00 Reunião"]);
  });
});

describe("agenda unificada e Hoje", () => {
  it("junta eventos, horários reservados (com o status da tarefa) e prazos de tarefas, sem copiar nada", async () => {
    const t = await createTask(ctx, { title: "Imposto de renda", due_date: "2026-10-16", priority: "high" });
    await createEvent(ctx, { title: "Imposto de renda", start: "2026-10-15T20:00", task_id: t.id });
    await createEvent(ctx, { title: "Dentista", start: "2026-10-15T14:00" });
    const agenda = await getAgenda(ctx, "2026-10-15", "2026-10-16");
    expect(agenda.map((i) => (i.kind === "event" ? `evento ${i.title} ${i.task?.status ?? ""}` : `prazo ${i.task.title} ${i.date}`))).toEqual([
      "evento Dentista ",
      "evento Imposto de renda todo",
      "prazo Imposto de renda 2026-10-16",
    ]);
    // Concluir a tarefa aparece no bloco da agenda e o prazo sai da agenda
    await updateTask(ctx, t.id, { status: "done" });
    const after = await getAgenda(ctx, "2026-10-15", "2026-10-16");
    expect(after.filter((i) => i.kind === "task_due")).toEqual([]);
    expect(after.find((i) => i.kind === "event" && i.task)).toMatchObject({ task: { status: "done" } });
  });

  it("Hoje: compromissos de hoje, próximos e tarefas atrasadas, de hoje e prioritárias", async () => {
    await createEvent(ctx, { title: "Hoje", start: "2026-10-15T18:00" });
    await createEvent(ctx, { title: "Amanhã", start: "2026-10-16T09:00" });
    await createEvent(ctx, { title: "Daqui a 10 dias", start: "2026-10-25T09:00" });
    await createTask(ctx, { title: "Atrasada", due_date: "2026-10-01" });
    await createTask(ctx, { title: "Para hoje", due_date: "2026-10-15" });
    await createTask(ctx, { title: "Importante", priority: "high" });
    await createTask(ctx, { title: "Comum" });
    const today = await getToday(ctx);
    expect(today).toMatchObject({ date: "2026-10-15", now: "2026-10-15T09:30" });
    expect(today.events.map((e) => e.title)).toEqual(["Hoje"]);
    expect(today.upcoming.map((e) => e.title)).toEqual(["Amanhã"]);
    expect(today.tasks.overdue.map((t) => t.title)).toEqual(["Atrasada"]);
    expect(today.tasks.today.map((t) => t.title)).toEqual(["Para hoje"]);
    expect(today.tasks.priority.map((t) => t.title)).toEqual(["Importante"]);
  });
});
