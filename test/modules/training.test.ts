import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { formatClock, formatDistance, formatPlanDuration, pace, parseDistance, parseDuration } from "../../src/shared/training";
import { createEvent } from "../../src/worker/modules/agenda/service";
import { getAgenda, getToday } from "../../src/worker/modules/today/service";
import {
  copyWeek,
  createSession,
  deleteSession,
  getSession,
  listHistory,
  listSessions,
  recordWorkout,
  updateSession,
  weekStats,
} from "../../src/worker/modules/training/service";
import { testCtx } from "../fixtures/finance";
import { resetLifeOS } from "../fixtures/lifeos";

// Quinta-feira, 15/10/2026; a semana vai de 12/10 (segunda) a 18/10 (domingo)
const ctx = testCtx(env.DB, "2026-10-15", "18:00");

beforeEach(() => resetLifeOS(env.DB));

const run = (date: string, extra: Record<string, unknown> = {}) =>
  createSession(ctx, { sport: "run", date, planned_duration_s: 3000, planned_distance_m: 10000, workout_type: "easy", ...extra });

describe("formatos", () => {
  it.each([
    ["45", 2700],
    ["52:10", 3130],
    ["1:02:30", 3750],
    ["1h30", 5400],
    ["1h", 3600],
    ["90min", 5400],
    ["", null],
    ["1:75", null],
    ["abc", null],
  ])("parseDuration(%j) = %j", (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it("distâncias: km com vírgula ou ponto; natação em metros", () => {
    expect(parseDistance("10,5", "run")).toBe(10500);
    expect(parseDistance("10.5", "run")).toBe(10500);
    expect(parseDistance("42,195 km", "run")).toBe(42195);
    expect(parseDistance("1.500", "swim")).toBe(1500);
    expect(parseDistance("0", "bike")).toBeNull();
    expect(formatDistance(10500, "run")).toBe("10,5 km");
    expect(formatDistance(1500, "swim")).toBe("1.500 m");
  });

  it("ritmo por modalidade e durações", () => {
    expect(pace(3130, 10200, "run")).toBe("5:07/km");
    expect(pace(1800, 1500, "swim")).toBe("2:00/100 m");
    expect(pace(5400, 45000, "bike")).toBe("30 km/h");
    expect(pace(3000, null, "run")).toBeNull();
    expect(formatClock(3750)).toBe("1:02:30");
    expect(formatPlanDuration(5400)).toBe("1 h 30");
  });
});

describe("planejar e registrar", () => {
  it("planejar cria um treino planejado; validações", async () => {
    const s = await run("2026-10-16", { time: "06:30", title: "Rodagem" });
    expect(s).toMatchObject({ status: "planned", unplanned: false, time: "06:30", actual_duration_s: null });
    await expect(createSession(ctx, { sport: "run", date: "2026-02-30" })).rejects.toThrow("data inválida");
    await expect(createSession(ctx, { sport: "yoga" as never, date: "2026-10-16" })).rejects.toThrow();
    await expect(createSession(ctx, { sport: "run", date: "2026-10-16", time: "25:00" })).rejects.toThrow("horário inválido");
    await expect(createSession(ctx, { sport: "run", date: "2026-10-16", actual_duration_s: 100 })).rejects.toThrow("Resultado só pode");
  });

  it("registrar o resultado atualiza o mesmo treino e guarda o plano separado", async () => {
    const s = await run("2026-10-15");
    const done = await updateSession(ctx, s.id, { status: "done", actual_duration_s: 3130, actual_distance_m: 10200, avg_hr: 148, max_hr: 171, rpe: 6 });
    expect(done).toMatchObject({ id: s.id, status: "done", planned_duration_s: 3000, actual_duration_s: 3130, actual_distance_m: 10200, rpe: 6 });
    expect(await listSessions(ctx, "2026-10-15", "2026-10-15")).toHaveLength(1);
    const log = await env.DB.prepare("SELECT action, detail FROM activity_log WHERE entity = 'training' AND entity_id = ?").bind(s.id).all();
    expect(log.results).toEqual([{ action: "training.status", detail: '{"from":"planned","to":"done"}' }]);
  });

  it("marcar como feito conforme o planejado copia os valores planejados para o realizado", async () => {
    const s = await run("2026-10-15");
    expect(await updateSession(ctx, s.id, { status: "done", as_planned: true })).toMatchObject({ actual_duration_s: 3000, actual_distance_m: 10000 });
  });

  it("realizado exige duração ou distância; FC máxima não pode ser menor que a média", async () => {
    const s = await createSession(ctx, { sport: "strength", date: "2026-10-15", title: "Treino A" });
    await expect(updateSession(ctx, s.id, { status: "done" })).rejects.toThrow("Informe a duração ou a distância");
    await expect(updateSession(ctx, s.id, { status: "done", as_planned: true })).rejects.toThrow("Informe a duração");
    await expect(updateSession(ctx, s.id, { status: "done", actual_duration_s: 2400, avg_hr: 150, max_hr: 140 })).rejects.toThrow("máxima");
    expect((await updateSession(ctx, s.id, { status: "partial", actual_duration_s: 1800 })).status).toBe("partial");
  });

  it("transições: realizado não vira não realizado sem desfazer; desfazer limpa o resultado", async () => {
    const s = await run("2026-10-14");
    await updateSession(ctx, s.id, { status: "done", as_planned: true });
    await expect(updateSession(ctx, s.id, { status: "skipped" })).rejects.toThrow("Desfaça o registro");
    const undone = await updateSession(ctx, s.id, { status: "planned" });
    expect(undone).toMatchObject({ status: "planned", actual_duration_s: null, actual_distance_m: null, rpe: null });
    expect((await updateSession(ctx, s.id, { status: "skipped" })).status).toBe("skipped");
    // Não realizado pode ser registrado depois (o usuário fez, afinal)
    expect((await updateSession(ctx, s.id, { status: "done", actual_duration_s: 1500 })).status).toBe("done");
  });

  it("editar o plano de um treino já realizado não mexe no resultado", async () => {
    const s = await run("2026-10-14");
    await updateSession(ctx, s.id, { status: "done", actual_duration_s: 3300 });
    const edited = await updateSession(ctx, s.id, { title: "Rodagem leve" });
    expect(edited).toMatchObject({ title: "Rodagem leve", status: "done", actual_duration_s: 3300 });
  });

  it("criar já realizado registra um treino sem plano", async () => {
    const s = await createSession(ctx, { sport: "bike", date: "2026-10-15", status: "done", actual_duration_s: 5400, actual_distance_m: 45000 });
    expect(s).toMatchObject({ unplanned: true, status: "done" });
  });
});

describe("recordWorkout (registrar o que foi feito)", () => {
  it("preenche o treino planejado da modalidade no dia, sem duplicar", async () => {
    const plan = await run("2026-10-15");
    const first = await recordWorkout(ctx, { sport: "run", actual_duration_s: 3100, actual_distance_m: 10000 });
    expect(first).toMatchObject({ matched_plan: true, session: { id: plan.id, status: "done" } });
    // Registrar de novo cria um avulso: o planejado já foi preenchido
    const second = await recordWorkout(ctx, { sport: "run", actual_duration_s: 1200 });
    expect(second).toMatchObject({ matched_plan: false, session: { unplanned: true } });
    expect(await listSessions(ctx, "2026-10-15", "2026-10-15")).toHaveLength(2);
  });

  it("avisa quando há mais de um planejado da modalidade no dia", async () => {
    await run("2026-10-15", { title: "Manhã" });
    await run("2026-10-15", { title: "Tarde" });
    await expect(recordWorkout(ctx, { sport: "run", actual_duration_s: 1800 })).rejects.toThrow("Informe qual");
  });
});

describe("semana e histórico", () => {
  it("indicadores: cumprimento só conta o que já venceu; cancelados saem da conta; avulsos não entram no %", async () => {
    const seg = await run("2026-10-12");
    const ter = await createSession(ctx, { sport: "swim", date: "2026-10-13", planned_distance_m: 2000, planned_duration_s: 2700 });
    const qua = await createSession(ctx, { sport: "strength", date: "2026-10-14", planned_duration_s: 3600 });
    const qui = await run("2026-10-15");
    await run("2026-10-17", { workout_type: "long", planned_distance_m: 18000, planned_duration_s: 6000 }); // ainda não venceu
    await updateSession(ctx, seg.id, { status: "done", actual_duration_s: 3100, actual_distance_m: 10200 });
    await updateSession(ctx, ter.id, { status: "partial", actual_distance_m: 1500, actual_duration_s: 2100 });
    await updateSession(ctx, qua.id, { status: "skipped" });
    await updateSession(ctx, qui.id, { status: "cancelled" });
    await createSession(ctx, { sport: "bike", date: "2026-10-18", status: "done", actual_duration_s: 3600, actual_distance_m: 30000 });

    const w = await weekStats(ctx, "2026-10-15");
    expect(w).toMatchObject({
      week_start: "2026-10-12",
      week_end: "2026-10-18",
      planned: 4, // seg, ter, qua, sáb (qui cancelado)
      done: 3, // seg, ter (parcial) e a bike avulsa
      partial: 1,
      skipped: 1,
      cancelled: 1,
      unplanned: 1,
      due: 3, // seg, ter, qua (sáb ainda não chegou)
      due_done: 2,
      compliance_pct: 67,
      planned_duration_s: 3000 + 2700 + 3600 + 6000,
      actual_duration_s: 3100 + 2100 + 3600,
    });
    const runVolume = w.by_sport.find((v) => v.sport === "run")!;
    expect(runVolume).toEqual({ sport: "run", sessions: 2, planned_duration_s: 9000, actual_duration_s: 3100, planned_distance_m: 28000, actual_distance_m: 10200 });
    expect(w.by_sport.map((v) => v.sport)).toEqual(["run", "bike", "swim", "strength"]);

    const history = await listHistory(ctx);
    expect(history.map((s) => s.sport)).toEqual(["bike", "swim", "run"]);
    expect((await listHistory(ctx, { sport: "swim" })).map((s) => s.id)).toEqual([ter.id]);
  });

  it("semana sem nada vencido não tem % de cumprimento", async () => {
    await run("2026-10-20");
    expect((await weekStats(ctx, "2026-10-20")).compliance_pct).toBeNull();
  });

  it("o treino de hoje ainda pendente não conta como falta; registrado, entra na conta", async () => {
    const today = await run("2026-10-15");
    expect(await weekStats(ctx, "2026-10-15")).toMatchObject({ due: 0, compliance_pct: null });
    await updateSession(ctx, today.id, { status: "done", as_planned: true });
    expect(await weekStats(ctx, "2026-10-15")).toMatchObject({ due: 1, due_done: 1, compliance_pct: 100 });
  });

  it("copiar a semana leva só o plano, nos mesmos dias da semana", async () => {
    const a = await run("2026-10-12", { time: "06:00" });
    await updateSession(ctx, a.id, { status: "done", as_planned: true });
    const cancelled = await run("2026-10-14");
    await updateSession(ctx, cancelled.id, { status: "cancelled" });
    await createSession(ctx, { sport: "bike", date: "2026-10-18", status: "done", actual_duration_s: 3600 });
    const copies = await copyWeek(ctx, "2026-10-15", "2026-10-21");
    expect(copies.map((c) => [c.date, c.time, c.status, c.actual_duration_s])).toEqual([["2026-10-19", "06:00", "planned", null]]);
  });
});

describe("agenda e Hoje", () => {
  it("treinos aparecem na agenda pelo horário e em Hoje, sem cópia em events", async () => {
    await createEvent(ctx, { title: "Reunião", start: "2026-10-15T09:00" });
    await run("2026-10-15", { time: "06:30" });
    await run("2026-10-15", { time: "19:00", title: "Regenerativo" });
    const agenda = await getAgenda(ctx, "2026-10-15", "2026-10-15");
    expect(agenda.map((i) => (i.kind === "training" ? `treino ${i.session.time}` : i.kind))).toEqual(["treino 06:30", "event", "treino 19:00"]);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM events").first<{ n: number }>())!.n).toBe(1);
    expect((await getToday(ctx)).training).toHaveLength(2);
  });

  it("excluir remove o treino", async () => {
    const s = await run("2026-10-15");
    await deleteSession(ctx, s.id);
    await expect(getSession(ctx, s.id)).rejects.toThrow("não encontrado");
  });
});
