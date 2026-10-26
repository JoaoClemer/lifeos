// Agenda: eventos únicos e séries com repetição. As ocorrências de uma série são calculadas para o intervalo pedido;
// só as ocorrências alteradas ou canceladas viram linhas próprias (series_id + original_start, únicas por ocorrência).
import { z } from "zod";
import type { CalendarEvent, EditScope, Occurrence, Participant } from "../../../shared/agenda";
import { addDays, addMinutes, diffDays, diffMinutes, fromLocal, isValidDate, isValidLocal } from "../../../shared/datetime";
import { countBefore, formatRRule, isOccurrence, occurrences, parseRRule, type RRule } from "../../../shared/recurrence";
import { type Ctx, nn, UserError } from "../../lib";
import { listConnections } from "../connections/service";
import { getTask } from "../tasks/service";

/** Texto opcional; vazio vira null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

const EventFields = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(4000),
  location: optionalText(300),
  url: z.preprocess((v) => (v === "" ? null : v), z.url({ protocol: /^https?$/, error: "link inválido (use http:// ou https://)" }).nullable()).optional(),
  category: optionalText(40),
  color: optionalText(20),
  all_day: z.boolean().optional(),
  /** Dia inteiro: 'YYYY-MM-DD'. Com horário: 'YYYY-MM-DDTHH:MM' (horário local). */
  start: z.string(),
  /** Dia inteiro: último dia (inclusive). Com horário: fim. Padrão: mesmo dia / 1 hora depois. */
  end: z.string().optional(),
  /** Repetição (RRULE, ex.: FREQ=WEEKLY;BYDAY=MO,WE). null = não repete. */
  rrule: z.string().nullable().optional(),
  task_id: z.number().int().nullable().optional(),
  /** Pessoas conectadas convidadas (ids). Numa série, o convite vale para a série toda. */
  participants: z.array(z.number().int()).max(30).optional(),
});
export const EventInput = EventFields;
export const EventPatch = EventFields.partial();
export const ScopeInput = z.object({
  scope: z.enum(["this", "following", "all"]).optional(),
  /** Início original da ocorrência (de Occurrence.occurrence_start). */
  occurrence_start: z.string().optional(),
});

type Row = Omit<CalendarEvent, "all_day" | "cancelled"> & { all_day: number; cancelled: number };
const COLS =
  "id, title, description, location, url, category, color, all_day, start_at, end_at, timezone, rrule, series_id, original_start, cancelled, task_id";
const decorate = (r: Row): CalendarEvent => ({ ...r, all_day: !!r.all_day, cancelled: !!r.cancelled });

export async function getEvent(ctx: Ctx, id: number): Promise<CalendarEvent> {
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM events WHERE id = ? AND user_id = ?`).bind(id, ctx.userId).first<Row>();
  if (!row) throw new UserError(`Evento ${id} não encontrado`, 404);
  return decorate(row);
}

function rule(text: string): RRule {
  try {
    return parseRRule(text);
  } catch (e) {
    throw new UserError(e instanceof Error ? e.message : String(e));
  }
}

/** Horário local precisa existir no fuso (não pode cair no salto do horário de verão). */
function checkExists(local: string, timezone: string) {
  if (fromLocal(local, timezone).kind === "nonexistent") {
    throw new UserError(`O horário ${local.slice(11)} de ${local.slice(0, 10)} não existe no fuso ${timezone} (mudança para o horário de verão)`);
  }
}

interface Timing {
  all_day: boolean;
  start_at: string;
  end_at: string;
}

/** Converte início/fim informados para o formato gravado, validando. */
function timing(allDay: boolean, start: string, end: string | undefined, timezone: string, defaultMinutes = 60): Timing {
  if (allDay) {
    const s = start.slice(0, 10);
    const e = (end ?? s).slice(0, 10);
    if (!isValidDate(s) || !isValidDate(e)) throw new UserError("Data inválida (use YYYY-MM-DD)");
    if (e < s) throw new UserError("O último dia não pode ser antes do primeiro");
    return { all_day: true, start_at: `${s}T00:00`, end_at: `${addDays(e, 1)}T00:00` };
  }
  if (!isValidLocal(start)) throw new UserError("Início inválido: informe data e horário (YYYY-MM-DDTHH:MM)");
  const endAt = end ?? addMinutes(start, defaultMinutes);
  if (!isValidLocal(endAt)) throw new UserError("Fim inválido: informe data e horário (YYYY-MM-DDTHH:MM)");
  if (endAt <= start) throw new UserError("O fim precisa ser depois do início");
  checkExists(start, timezone);
  checkExists(endAt, timezone);
  return { all_day: false, start_at: start, end_at: endAt };
}

/** Novo horário a partir de um patch, partindo do horário atual (mantém a duração se só o início mudar). */
function patchedTiming(cur: Timing, p: z.output<typeof EventPatch>, timezone: string): Timing | null {
  if (p.start === undefined && p.end === undefined && p.all_day === undefined) return null;
  const allDay = p.all_day ?? cur.all_day;
  if (allDay) {
    const days = cur.all_day ? diffDays(cur.start_at.slice(0, 10), cur.end_at.slice(0, 10)) : 1;
    const start = (p.start ?? cur.start_at).slice(0, 10);
    return timing(true, start, p.end ?? addDays(start, days - 1), timezone);
  }
  const start = p.start ?? (cur.all_day ? undefined : cur.start_at);
  if (!start || start.length < 16) throw new UserError("Informe o horário de início");
  const minutes = cur.all_day ? 60 : diffMinutes(cur.start_at, cur.end_at);
  return timing(false, start, p.end, timezone, minutes);
}

async function checkTask(ctx: Ctx, taskId: number | null | undefined) {
  if (taskId) await getTask(ctx, taskId);
}

export async function createEvent(ctx: Ctx, input: z.input<typeof EventInput>): Promise<CalendarEvent> {
  const e = EventInput.parse(input);
  const t = timing(!!e.all_day, e.start, e.end, ctx.timezone);
  const rrule = e.rrule ? formatRRule(rule(e.rrule)) : null;
  await checkTask(ctx, e.task_id);
  const row = await ctx.db
    .prepare(
      `INSERT INTO events (user_id, title, description, location, url, category, color, all_day, start_at, end_at, timezone, rrule, task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.userId, e.title, nn(e.description), nn(e.location), nn(e.url), nn(e.category), nn(e.color), t.all_day ? 1 : 0, t.start_at, t.end_at, ctx.timezone, rrule, nn(e.task_id))
    .first<{ id: number }>();
  await applyParticipants(ctx, row!.id, e.participants);
  return getEvent(ctx, row!.id);
}

// ---------- consulta ----------

function toOccurrence(e: CalendarEvent, extra: Partial<Occurrence> = {}): Occurrence {
  return {
    event_id: e.series_id ?? e.id,
    occurrence_start: e.original_start,
    modified: !!e.series_id,
    rrule: e.rrule,
    title: e.title,
    description: e.description,
    location: e.location,
    url: e.url,
    category: e.category,
    color: e.color,
    all_day: e.all_day,
    start_at: e.start_at,
    end_at: e.end_at,
    task_id: e.task_id,
    invite: null,
    participants: 0,
    ...extra,
  };
}

/** Eventos seus ou para os quais você foi convidado(a) e não recusou (?1 = você). */
const VISIBLE = "(user_id = ?1 OR id IN (SELECT event_id FROM event_participants WHERE user_id = ?1 AND status <> 'declined'))";

/**
 * Ocorrências que acontecem (ao menos em parte) entre os dias `from` e `to` (inclusive), em ordem.
 * Inclui eventos de pessoas conectadas que te convidaram (marcados em `invite`, sem a tarefa ligada a eles).
 */
export async function listOccurrences(ctx: Ctx, from: string, to: string): Promise<Occurrence[]> {
  if (!isValidDate(from) || !isValidDate(to) || to < from) throw new UserError("Intervalo inválido (use datas YYYY-MM-DD)");
  if (diffDays(from, to) > 400) throw new UserError("Intervalo grande demais (máximo de 400 dias)");
  const wStart = `${from}T00:00`;
  const wEnd = `${addDays(to, 1)}T00:00`;
  const [singles, series, invites, counts] = await ctx.db.batch<Row & { owner_id: number }>([
    ctx.db
      .prepare(`SELECT ${COLS}, user_id AS owner_id FROM events WHERE ${VISIBLE} AND series_id IS NULL AND rrule IS NULL AND start_at < ?2 AND end_at > ?3`)
      .bind(ctx.userId, wEnd, wStart),
    ctx.db.prepare(`SELECT ${COLS}, user_id AS owner_id FROM events WHERE ${VISIBLE} AND series_id IS NULL AND rrule IS NOT NULL AND start_at < ?2`).bind(ctx.userId, wEnd),
    // Convites que você recebeu: de quem é o evento e se já aceitou
    ctx.db
      .prepare(
        `SELECT ep.event_id, ep.status, e.user_id AS owner_id, u.name AS owner_name FROM event_participants ep
         JOIN events e ON e.id = ep.event_id JOIN users u ON u.id = e.user_id
         WHERE ep.user_id = ? AND ep.status <> 'declined'`,
      )
      .bind(ctx.userId),
    // Seus eventos: quantas pessoas convidou
    ctx.db
      .prepare(
        `SELECT ep.event_id, COUNT(*) AS n FROM event_participants ep JOIN events e ON e.id = ep.event_id AND e.user_id = ?1
         WHERE ep.status <> 'declined' AND ep.user_id <> ?1 GROUP BY ep.event_id`,
      )
      .bind(ctx.userId),
  ]);
  const inviteOf = new Map(
    (invites.results as unknown as { event_id: number; status: "invited" | "accepted"; owner_id: number; owner_name: string | null }[]).map((i) => [
      i.event_id,
      { owner_id: i.owner_id, owner_name: i.owner_name, status: i.status },
    ]),
  );
  const countOf = new Map((counts.results as unknown as { event_id: number; n: number }[]).map((c) => [c.event_id, c.n]));
  // Em evento de outra pessoa: com o convite e sem a tarefa dela; nos seus: quantos convidados
  const shareInfo = (eventId: number, ownerId: number): Partial<Occurrence> =>
    ownerId === ctx.userId ? { participants: countOf.get(eventId) ?? 0 } : { invite: inviteOf.get(eventId) ?? null, task_id: null };

  const masters = series.results.map((r) => ({ ...decorate(r), owner_id: r.owner_id }));
  // Ocorrências alteradas: são de quem criou a série
  const exceptions = masters.length
    ? (
        await ctx.db
          .prepare(
            `SELECT ${COLS} FROM events x
             WHERE x.series_id IN (${masters.map(() => "?").join(", ")}) AND x.user_id = (SELECT m.user_id FROM events m WHERE m.id = x.series_id)`,
          )
          .bind(...masters.map((m) => m.id))
          .all<Row>()
      ).results.map(decorate)
    : [];

  const out: Occurrence[] = singles.results.map((r) => toOccurrence(decorate(r), shareInfo(r.id, r.owner_id)));
  for (const m of masters) {
    const r = parseRRule(m.rrule!);
    const minutes = diffMinutes(m.start_at, m.end_at);
    const changed = new Set(exceptions.filter((x) => x.series_id === m.id).map((x) => x.original_start));
    for (const start of occurrences(m.start_at, r, addMinutes(wStart, -minutes), wEnd)) {
      if (changed.has(start)) continue;
      out.push(toOccurrence(m, { occurrence_start: start, start_at: start, end_at: addMinutes(start, minutes), ...shareInfo(m.id, m.owner_id) }));
    }
  }
  const masterOf = new Map(masters.map((m) => [m.id, m]));
  for (const x of exceptions) {
    const m = masterOf.get(x.series_id!)!;
    if (!x.cancelled && x.start_at < wEnd && x.end_at > wStart) out.push(toOccurrence(x, { rrule: m.rrule, ...shareInfo(m.id, m.owner_id) }));
  }
  return out.sort(
    (a, b) => a.start_at.localeCompare(b.start_at) || Number(b.all_day) - Number(a.all_day) || a.title.localeCompare(b.title) || a.event_id - b.event_id,
  );
}

// ---------- convidados ----------

/** Convidados de um evento seu (em série, use o id da série). */
export async function listParticipants(ctx: Ctx, eventId: number): Promise<Participant[]> {
  const ev = await getEvent(ctx, eventId);
  const rows = await ctx.db
    .prepare(
      `SELECT ep.user_id, u.name, ep.status FROM event_participants ep JOIN users u ON u.id = ep.user_id
       JOIN events e ON e.id = ep.event_id AND e.user_id = ? WHERE ep.event_id = ? ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(ctx.userId, ev.series_id ?? ev.id)
    .all<Participant>();
  return rows.results;
}

async function applyParticipants(ctx: Ctx, eventId: number, userIds: number[] | undefined): Promise<void> {
  if (userIds !== undefined) await ctx.db.batch(await participantStatements(ctx, eventId, userIds));
}

/** Comandos para deixar os convidados do evento exatamente como `userIds` (só pessoas conectadas). Quem continua mantém a resposta. */
async function participantStatements(ctx: Ctx, eventId: number, userIds: number[]): Promise<D1PreparedStatement[]> {
  const ids = [...new Set(userIds)];
  if (ids.length) {
    const connected = new Set((await listConnections(ctx)).map((c) => c.user_id));
    const outsider = ids.find((id) => !connected.has(id));
    if (outsider) throw new UserError("Só dá para convidar pessoas conectadas a você", 404);
  }
  return [
    ctx.db
      .prepare(
        `DELETE FROM event_participants WHERE event_id = ?1 AND user_id <> ?2 ${ids.length ? `AND user_id NOT IN (${ids.map(() => "?").join(", ")})` : ""}
         AND EXISTS (SELECT 1 FROM events e WHERE e.id = ?1 AND e.user_id = ?2)`,
      )
      .bind(eventId, ctx.userId, ...ids),
    ...ids.map((id) =>
      ctx.db
        .prepare(
          `INSERT OR IGNORE INTO event_participants (event_id, user_id)
           SELECT e.id, ? FROM events e WHERE e.id = ? AND e.user_id = ?`,
        )
        .bind(id, eventId, ctx.userId),
    ),
  ];
}

/** Aceitar ou recusar um convite (em série, vale para a série toda). Recusado, o evento sai da sua agenda. */
export async function respondInvite(ctx: Ctx, eventId: number, status: "accepted" | "declined"): Promise<void> {
  const res = await ctx.db
    .prepare("UPDATE event_participants SET status = ?, responded_at = datetime('now') WHERE event_id = ? AND user_id = ?")
    .bind(status, eventId, ctx.userId)
    .run();
  if (!res.meta.changes) throw new UserError(`Convite para o evento ${eventId} não encontrado`, 404);
}

/** Evento com o mesmo título e início criado há pouco (evita duplicar quando o Claude repete uma chamada). */
export async function findRecentEvent(ctx: Ctx, title: string, startAt: string, minutes = 10): Promise<CalendarEvent | null> {
  const row = await ctx.db
    .prepare(
      `SELECT ${COLS} FROM events WHERE user_id = ? AND series_id IS NULL AND lower(title) = lower(?) AND start_at = ? AND created_at >= datetime('now', ?) ORDER BY id DESC LIMIT 1`,
    )
    .bind(ctx.userId, title.trim(), startAt, `-${minutes} minutes`)
    .first<Row>();
  return row ? decorate(row) : null;
}

/** Eventos ligados a uma tarefa (horários reservados para ela). */
export async function listTaskEvents(ctx: Ctx, taskId: number): Promise<CalendarEvent[]> {
  const rows = await ctx.db
    .prepare(`SELECT ${COLS} FROM events WHERE task_id = ? AND user_id = ? AND cancelled = 0 ORDER BY start_at`)
    .bind(taskId, ctx.userId)
    .all<Row>();
  return rows.results.map(decorate);
}

export async function listCategories(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.db
    .prepare(
      "SELECT category, COUNT(*) AS n FROM events WHERE user_id = ? AND category IS NOT NULL AND category <> '' GROUP BY category ORDER BY n DESC, category LIMIT 30",
    )
    .bind(ctx.userId)
    .all<{ category: string }>();
  return rows.results.map((r) => r.category);
}

// ---------- alteração e exclusão ----------

interface SeriesTarget {
  series: CalendarEvent;
  rule: RRule;
  occ: string;
  /** Ocorrência já alterada (linha própria), se houver. */
  exception: CalendarEvent | null;
}

/** Resolve qual ocorrência de qual série está sendo alterada. Aceita o id da série ou o id de uma ocorrência alterada. */
async function seriesTarget(ctx: Ctx, ev: CalendarEvent, occurrenceStart: string | undefined): Promise<SeriesTarget> {
  const series = ev.series_id ? await getEvent(ctx, ev.series_id) : ev;
  const occ = ev.series_id ? ev.original_start! : occurrenceStart;
  if (!occ) throw new UserError("Informe qual ocorrência (occurrence_start) da série");
  const r = parseRRule(series.rrule!);
  const exception = ev.series_id
    ? ev
    : await ctx.db
        .prepare(`SELECT ${COLS} FROM events WHERE series_id = ? AND original_start = ? AND user_id = ?`)
        .bind(series.id, occ, ctx.userId)
        .first<Row>()
        .then((x) => (x ? decorate(x) : null));
  if (!exception && !isOccurrence(series.start_at, r, occ)) throw new UserError(`${occ} não é uma ocorrência desta série`);
  return { series, rule: r, occ, exception };
}

function needScope(scope: EditScope | undefined): EditScope {
  if (!scope) throw new UserError("Evento repetido: informe se a mudança vale só para esta ocorrência (this), para esta e as seguintes (following) ou para todas (all)");
  return scope;
}

/** Regra da série encerrada antes da ocorrência `occ` e a regra que continua a partir dela. */
function splitRule(series: CalendarEvent, r: RRule, occ: string): { before: RRule; after: RRule } {
  if (r.count) {
    const n = countBefore(series.start_at, r, occ);
    return { before: { ...r, count: n }, after: { ...r, count: r.count - n } };
  }
  return { before: { ...r, until: addDays(occ.slice(0, 10), -1) }, after: r };
}

const PATCH_COLUMNS = ["title", "description", "location", "url", "category", "color", "task_id"] as const;

function fieldsOf(e: CalendarEvent, p: z.output<typeof EventPatch>, t: Timing) {
  const v = (k: (typeof PATCH_COLUMNS)[number]) => (p[k] !== undefined ? p[k] : e[k]);
  return {
    title: v("title") as string,
    description: v("description") as string | null,
    location: v("location") as string | null,
    url: v("url") as string | null,
    category: v("category") as string | null,
    color: v("color") as string | null,
    task_id: v("task_id") as number | null,
    all_day: t.all_day ? 1 : 0,
    start_at: t.start_at,
    end_at: t.end_at,
  };
}

function updateStmt(ctx: Ctx, id: number, fields: Record<string, string | number | null>) {
  const keys = Object.keys(fields);
  return ctx.db
    .prepare(`UPDATE events SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(...Object.values(fields), id, ctx.userId);
}

/**
 * Altera um evento. Em séries, `scope` diz o alcance:
 * - this: só a ocorrência `occurrence_start` (grava/atualiza a linha da ocorrência; nunca duplica);
 * - following: divide a série; a parte antiga termina antes da ocorrência e uma nova série começa nela;
 * - all: altera a série inteira. Se o horário ou a repetição mudarem, as ocorrências alteradas individualmente são descartadas.
 */
export async function updateEvent(ctx: Ctx, id: number, patch: z.input<typeof EventPatch>, scopeInput: z.input<typeof ScopeInput> = {}): Promise<CalendarEvent> {
  const p = EventPatch.parse(patch);
  const { scope, occurrence_start } = ScopeInput.parse(scopeInput);
  if (p.task_id !== undefined) await checkTask(ctx, p.task_id);
  const ev = await getEvent(ctx, id);
  const newRule = p.rrule === undefined ? undefined : p.rrule ? formatRRule(rule(p.rrule)) : null;

  if (!ev.rrule && !ev.series_id) {
    const t = patchedTiming(ev, p, ev.timezone) ?? ev;
    await updateStmt(ctx, id, { ...fieldsOf(ev, p, t), ...(newRule !== undefined ? { rrule: newRule } : {}) }).run();
    await applyParticipants(ctx, id, p.participants);
    return getEvent(ctx, id);
  }

  const { series, rule: r, occ, exception } = await seriesTarget(ctx, ev, occurrence_start);
  const minutes = diffMinutes(series.start_at, series.end_at);
  const occTiming: Timing = exception ?? { all_day: series.all_day, start_at: occ, end_at: addMinutes(occ, minutes) };
  const s = needScope(scope);

  if (s === "this") {
    if (newRule !== undefined) throw new UserError("Para mudar a repetição, altere esta e as seguintes ou todas");
    const t = patchedTiming(occTiming, p, series.timezone) ?? occTiming;
    const base = exception ?? series;
    const fields = fieldsOf(base, p, t);
    if (exception) {
      await updateStmt(ctx, exception.id, { ...fields, cancelled: 0 }).run();
      await applyParticipants(ctx, series.id, p.participants);
      return getEvent(ctx, exception.id);
    }
    const row = await ctx.db
      .prepare(
        `INSERT INTO events (title, description, location, url, category, color, task_id, all_day, start_at, end_at, timezone, series_id, original_start, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(...Object.values(fields), series.timezone, series.id, occ, ctx.userId)
      .first<{ id: number }>();
    await applyParticipants(ctx, series.id, p.participants);
    return getEvent(ctx, row!.id);
  }

  const first = countBefore(series.start_at, r, occ) === 0;
  if (s === "all" || first) {
    // O horário informado é o da ocorrência editada: desloca a série inteira pela mesma diferença
    let t: Timing = series;
    const pt = patchedTiming(occTiming, p, series.timezone);
    if (pt) {
      const shift = diffMinutes(occTiming.start_at, pt.start_at);
      const start = addMinutes(series.start_at, shift);
      t = { all_day: pt.all_day, start_at: start, end_at: addMinutes(start, diffMinutes(pt.start_at, pt.end_at)) };
      if (!t.all_day) (checkExists(t.start_at, series.timezone), checkExists(t.end_at, series.timezone));
    }
    const timingChanged = t.start_at !== series.start_at || t.end_at !== series.end_at || (newRule !== undefined && newRule !== series.rrule);
    await ctx.db.batch([
      updateStmt(ctx, series.id, { ...fieldsOf(series, p, t), ...(newRule !== undefined ? { rrule: newRule } : {}) }),
      ...(timingChanged ? [ctx.db.prepare("DELETE FROM events WHERE series_id = ? AND user_id = ?").bind(series.id, ctx.userId)] : []),
    ]);
    await applyParticipants(ctx, series.id, p.participants);
    return getEvent(ctx, series.id);
  }

  // following: a série antiga termina antes da ocorrência; uma nova série começa nela, com as alterações
  const { before, after } = splitRule(series, r, occ);
  const base: Timing = { all_day: series.all_day, start_at: occ, end_at: addMinutes(occ, minutes) };
  const t = patchedTiming(base, p, series.timezone) ?? base;
  const nextRule = newRule !== undefined ? newRule : formatRRule(after);
  const fields = fieldsOf(series, p, t);
  const keepExceptions = t.start_at === base.start_at && t.end_at === base.end_at && newRule === undefined;
  const results = await ctx.db.batch<{ id: number }>([
    ctx.db
      .prepare(
        `INSERT INTO events (title, description, location, url, category, color, task_id, all_day, start_at, end_at, timezone, rrule, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(...Object.values(fields), series.timezone, nextRule, ctx.userId),
    keepExceptions
      ? ctx.db
          .prepare("UPDATE events SET series_id = last_insert_rowid() WHERE series_id = ? AND original_start >= ? AND user_id = ?")
          .bind(series.id, occ, ctx.userId)
      : ctx.db.prepare("DELETE FROM events WHERE series_id = ? AND original_start >= ? AND user_id = ?").bind(series.id, occ, ctx.userId),
    updateStmt(ctx, series.id, { rrule: formatRRule(before) }),
  ]);
  // A nova série leva os mesmos convidados (com as respostas deles)
  const newId = results[0].results[0].id;
  await ctx.db
    .prepare(
      `INSERT OR IGNORE INTO event_participants (event_id, user_id, status)
       SELECT ?1, ep.user_id, ep.status FROM event_participants ep JOIN events e ON e.id = ep.event_id AND e.user_id = ?3 WHERE ep.event_id = ?2`,
    )
    .bind(newId, series.id, ctx.userId)
    .run();
  await applyParticipants(ctx, newId, p.participants);
  return getEvent(ctx, newId);
}

/** Exclui um evento. Em séries, `scope`: this (cancela só a ocorrência), following (encerra a série antes dela) ou all. */
export async function deleteEvent(ctx: Ctx, id: number, scopeInput: z.input<typeof ScopeInput> = {}): Promise<{ deleted: number }> {
  const { scope, occurrence_start } = ScopeInput.parse(scopeInput);
  const ev = await getEvent(ctx, id);
  if (!ev.rrule && !ev.series_id) {
    await ctx.db.prepare("DELETE FROM events WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
    return { deleted: 1 };
  }
  const { series, rule: r, occ, exception } = await seriesTarget(ctx, ev, occurrence_start);
  const s = needScope(scope);
  if (s === "this") {
    if (exception) await updateStmt(ctx, exception.id, { cancelled: 1 }).run();
    else {
      const minutes = diffMinutes(series.start_at, series.end_at);
      await ctx.db
        .prepare(
          `INSERT INTO events (user_id, title, all_day, start_at, end_at, timezone, series_id, original_start, cancelled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .bind(ctx.userId, series.title, series.all_day ? 1 : 0, occ, addMinutes(occ, minutes), series.timezone, series.id, occ)
        .run();
    }
    return { deleted: 1 };
  }
  if (s === "all" || countBefore(series.start_at, r, occ) === 0) {
    await ctx.db.prepare("DELETE FROM events WHERE id = ? AND user_id = ?").bind(series.id, ctx.userId).run();
    return { deleted: -1 };
  }
  const { before } = splitRule(series, r, occ);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM events WHERE series_id = ? AND original_start >= ? AND user_id = ?").bind(series.id, occ, ctx.userId),
    updateStmt(ctx, series.id, { rrule: formatRRule(before) }),
  ]);
  return { deleted: -1 };
}
