import { z } from "zod";
import { addMonths, DATE_RE, monthDiff, monthOf, MONTH_RE } from "../../shared/month";
import type { Goal, GoalEntry, GoalMember } from "../../shared/types";
import { type Ctx, findByName, nn, updateRow, UserError } from "../lib";
import { listConnections } from "../modules/connections/service";

export const GoalInput = z.object({
  name: z.string().trim().min(1),
  institution: z.string().trim().nullable().optional(),
  target_cents: z.number().int().positive().nullable().optional(),
  monthly_cents: z.number().int().positive().nullable().optional(),
  deadline: z.string().regex(MONTH_RE).nullable().optional(),
  start_month: z.string().regex(MONTH_RE).optional(),
  color: z.string().nullable().optional(),
  /** Quanto você já tem guardado/investido hoje. */
  initial_cents: z.number().int().nonnegative().optional(),
});
export const GoalPatch = GoalInput.omit({ initial_cents: true }).partial().extend({ archived: z.boolean().optional() });

export const GoalEntryInput = z.object({
  kind: z.enum(["contribution", "withdrawal", "adjustment"]),
  /** Para aporte/resgate: valor positivo. Para ajuste: variação com sinal. */
  amount_cents: z.number().int(),
  date: z.string().regex(DATE_RE).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  note: z.string().nullable().optional(),
});

/** O que o cálculo do aporte planejado precisa (também usado pelo saldo acumulado, em balance.ts). */
export interface GoalCalc {
  target_cents: number | null;
  /** Seu aporte mensal planejado. */
  monthly_cents: number | null;
  deadline: string | null;
  start_month: string;
  archived: number;
  /** Saldo da meta (em conjunto: de todos). */
  balance_cents: number;
  /** Seus aportes líquidos no mês. */
  month_contrib_cents: number;
  /** Em conjunto: aporte mensal planejado somando todos (sem isso, o seu). */
  team_monthly_cents?: number | null;
  /** Em conjunto: aportes líquidos de todos no mês (sem isso, os seus). */
  team_month_contrib_cents?: number;
}

/**
 * Calcula aporte planejado (seu), previsão e aporte necessário de uma meta no mês.
 * Numa meta só sua, os valores "do grupo" são os seus. Usado também pelo saldo acumulado: as duas contas precisam concordar.
 */
export function decorateGoal<T extends GoalCalc>(g: T, month: string): T & Pick<Goal, "month_planned_cents" | "eta_month" | "required_monthly_cents"> {
  const teamMonthly = g.team_monthly_cents === undefined ? g.monthly_cents : g.team_monthly_cents || null;
  const teamContrib = g.team_month_contrib_cents ?? g.month_contrib_cents;
  const remaining = g.target_cents ? Math.max(g.target_cents - g.balance_cents, 0) : null;
  // Saldo no início do mês (desconsiderando os aportes deste mês) para saber se ainda havia aporte a fazer
  const remainingAtStart = remaining === null ? null : remaining + teamContrib;
  const active = !g.archived && g.start_month <= month && (!g.deadline || g.deadline >= month);
  const month_planned_cents =
    active && g.monthly_cents && (remainingAtStart === null || remainingAtStart > 0)
      ? Math.min(g.monthly_cents, remainingAtStart ?? g.monthly_cents)
      : 0;
  let eta_month: string | null = null;
  if (remaining !== null && teamMonthly) {
    eta_month = remaining === 0 ? month : addMonths(month, Math.ceil(remaining / teamMonthly) - (teamContrib >= teamMonthly ? 0 : 1));
  }
  let required_monthly_cents: number | null = null;
  if (remaining !== null && g.deadline) {
    const months = Math.max(monthDiff(month, g.deadline) + (teamContrib > 0 ? 0 : 1), 1);
    required_monthly_cents = Math.ceil(remaining / months);
  }
  return { ...g, month_planned_cents, eta_month, required_monthly_cents };
}

// ?1 = mês, ?2 = você. Metas suas ou das quais você participa; seu aporte mensal e seus aportes do mês; saldo de todos.
const SELECT = `SELECT g.id, g.name, g.institution, g.target_cents,
  CASE WHEN g.user_id = ?2 THEN g.monthly_cents ELSE gm.monthly_cents END AS monthly_cents,
  g.deadline, g.start_month, g.color, g.archived, g.user_id AS owner_id, ou.name AS owner_name,
  (SELECT COUNT(*) FROM goal_members m WHERE m.goal_id = g.id AND m.user_id <> g.user_id) AS member_count,
  COALESCE(g.monthly_cents, 0) + COALESCE((SELECT SUM(m.monthly_cents) FROM goal_members m WHERE m.goal_id = g.id AND m.user_id <> g.user_id), 0) AS team_monthly_cents,
  COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id), 0) AS balance_cents,
  COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id AND e.user_id = ?2 AND e.month = ?1 AND e.kind IN ('contribution', 'withdrawal')), 0) AS month_contrib_cents,
  COALESCE((SELECT SUM(e.amount_cents) FROM goal_entries e WHERE e.goal_id = g.id AND e.month = ?1 AND e.kind IN ('contribution', 'withdrawal')), 0) AS team_month_contrib_cents
  FROM goals g LEFT JOIN goal_members gm ON gm.goal_id = g.id AND gm.user_id = ?2 LEFT JOIN users ou ON ou.id = g.user_id`;
const ACCESS = "(g.user_id = ?2 OR gm.user_id = ?2)";

type Row = Omit<Goal, "month_planned_cents" | "eta_month" | "required_monthly_cents" | "owner" | "members"> & {
  owner_id: number;
  owner_name: string | null;
  member_count: number;
  team_monthly_cents: number;
  team_month_contrib_cents: number;
};

/** Quem participa de cada meta em conjunto (com o aporte planejado e o aporte do mês de cada um). */
async function membersOf(ctx: Ctx, goalIds: number[], month: string): Promise<Map<number, GoalMember[]>> {
  const out = new Map<number, GoalMember[]>();
  if (!goalIds.length) return out;
  const ph = goalIds.map(() => "?").join(", ");
  const [people, contrib] = await ctx.db.batch<{ goal_id: number; id: number; name: string | null; role: "owner" | "member"; monthly_cents: number | null; total: number }>([
    ctx.db
      .prepare(
        `SELECT g.id AS goal_id, u.id, u.name, 'owner' AS role, g.monthly_cents FROM goals g JOIN users u ON u.id = g.user_id WHERE g.id IN (${ph})
         UNION ALL
         SELECT m.goal_id, u.id, u.name, 'member' AS role, m.monthly_cents FROM goal_members m JOIN users u ON u.id = m.user_id WHERE m.goal_id IN (${ph})`,
      )
      .bind(...goalIds, ...goalIds),
    ctx.db
      .prepare(
        `SELECT goal_id, user_id AS id, SUM(amount_cents) AS total FROM goal_entries
         WHERE goal_id IN (${ph}) AND month = ? AND kind IN ('contribution', 'withdrawal') GROUP BY goal_id, user_id`,
      )
      .bind(...goalIds, month),
  ]);
  const contribOf = new Map(contrib.results.map((c) => [`${c.goal_id}|${c.id}`, c.total]));
  for (const p of people.results) {
    const list = out.get(p.goal_id) ?? [];
    list.push({ id: p.id, name: p.name, role: p.role, monthly_cents: p.monthly_cents, month_contrib_cents: contribOf.get(`${p.goal_id}|${p.id}`) ?? 0 });
    out.set(p.goal_id, list);
  }
  return out;
}

async function decorateAll(ctx: Ctx, rows: Row[], month: string): Promise<Goal[]> {
  const members = await membersOf(
    ctx,
    rows.filter((r) => r.member_count > 0).map((r) => r.id),
    month,
  );
  return rows.map(({ owner_id, owner_name, member_count, ...r }) => {
    // Meta só sua: o grupo é você (os números ficam iguais aos de sempre)
    const solo = member_count === 0;
    const g = decorateGoal({ ...r, ...(solo ? { team_monthly_cents: r.monthly_cents, team_month_contrib_cents: r.month_contrib_cents } : {}) }, month);
    const { team_monthly_cents: _t, team_month_contrib_cents: _c, ...goal } = g;
    return { ...goal, owner: owner_id === ctx.userId ? null : { id: owner_id, name: owner_name }, members: members.get(r.id) ?? [] };
  });
}

export async function listGoals(ctx: Ctx, month: string, includeArchived = false): Promise<Goal[]> {
  const sql = `${SELECT} WHERE ${ACCESS} ${includeArchived ? "" : "AND g.archived = 0"} ORDER BY g.archived, g.id`;
  return decorateAll(ctx, (await ctx.db.prepare(sql).bind(month, ctx.userId).all<Row>()).results, month);
}

export async function getGoal(ctx: Ctx, id: number, month = ctx.month): Promise<Goal> {
  const row = await ctx.db.prepare(`${SELECT} WHERE ${ACCESS} AND g.id = ?3`).bind(month, ctx.userId, id).first<Row>();
  if (!row) throw new UserError(`Meta ${id} não encontrada`, 404);
  return (await decorateAll(ctx, [row], month))[0];
}

/** Só quem criou a meta altera, exclui ou define quem participa. */
async function ownGoal(ctx: Ctx, id: number): Promise<Goal> {
  const g = await getGoal(ctx, id);
  if (g.owner) throw new UserError(`Só ${g.owner.name ?? "quem criou a meta"} pode alterar esta meta`, 403);
  return g;
}

export async function createGoal(ctx: Ctx, input: z.input<typeof GoalInput>): Promise<Goal> {
  const g = GoalInput.parse(input);
  const start = g.start_month ?? ctx.month;
  const row = await ctx.db
    .prepare(
      `INSERT INTO goals (user_id, name, institution, target_cents, monthly_cents, deadline, start_month, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.userId, g.name, nn(g.institution), nn(g.target_cents), nn(g.monthly_cents), nn(g.deadline), start, nn(g.color))
    .first<{ id: number }>();
  if (g.initial_cents) {
    await ctx.db
      .prepare(`INSERT INTO goal_entries (user_id, goal_id, kind, amount_cents, month, date, note) VALUES (?, ?, 'adjustment', ?, ?, ?, 'Saldo inicial')`)
      .bind(ctx.userId, row!.id, g.initial_cents, ctx.month, ctx.today)
      .run();
  }
  return getGoal(ctx, row!.id);
}

export async function updateGoal(ctx: Ctx, id: number, patch: z.input<typeof GoalPatch>): Promise<Goal> {
  const p = GoalPatch.parse(patch);
  await ownGoal(ctx, id);
  await updateRow(ctx, "goals", id, p, ["name", "institution", "target_cents", "monthly_cents", "deadline", "start_month", "color", "archived"]);
  return getGoal(ctx, id);
}

/** Exclui a meta e todas as movimentações (de todos que participam). */
export async function deleteGoal(ctx: Ctx, id: number): Promise<Goal> {
  const cur = await ownGoal(ctx, id);
  await ctx.db.prepare("DELETE FROM goals WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}

/** Movimentações da meta (em conjunto: de todos, com quem fez). */
export async function listGoalEntries(ctx: Ctx, goalId: number): Promise<GoalEntry[]> {
  await getGoal(ctx, goalId);
  const rows = await ctx.db
    .prepare(
      `SELECT e.id, e.goal_id, e.kind, e.amount_cents, e.month, e.date, e.note, e.user_id AS author_id, u.name AS author_name
       FROM goal_entries e LEFT JOIN users u ON u.id = e.user_id WHERE e.goal_id = ? ORDER BY e.date DESC, e.id DESC`,
    )
    .bind(goalId)
    .all<Omit<GoalEntry, "author" | "mine"> & { author_id: number; author_name: string | null }>();
  return rows.results.map(({ author_id, author_name, ...e }) => ({ ...e, author: author_id === ctx.userId ? null : author_name, mine: author_id === ctx.userId }));
}

export async function addGoalEntry(ctx: Ctx, goalId: number, input: z.input<typeof GoalEntryInput>): Promise<GoalEntry> {
  const e = GoalEntryInput.parse(input);
  await getGoal(ctx, goalId);
  if (e.kind !== "adjustment" && e.amount_cents <= 0) throw new UserError("O valor deve ser positivo");
  const signed = e.kind === "withdrawal" ? -e.amount_cents : e.amount_cents;
  const date = e.date ?? ctx.today;
  const row = await ctx.db
    .prepare(
      `INSERT INTO goal_entries (user_id, goal_id, kind, amount_cents, month, date, note) VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING id, goal_id, kind, amount_cents, month, date, note`,
    )
    .bind(ctx.userId, goalId, e.kind, signed, e.month ?? monthOf(date), date, nn(e.note))
    .first<Omit<GoalEntry, "author" | "mine">>();
  return { ...row!, author: null, mine: true };
}

/** Exclui uma movimentação sua. */
export async function deleteGoalEntry(ctx: Ctx, entryId: number): Promise<void> {
  const res = await ctx.db.prepare("DELETE FROM goal_entries WHERE id = ? AND user_id = ?").bind(entryId, ctx.userId).run();
  if (!res.meta.changes) throw new UserError(`Movimentação ${entryId} não encontrada`, 404);
}

/** Atualiza o saldo atual (ex.: com rendimentos) lançando um ajuste pela diferença. */
export async function setGoalBalance(ctx: Ctx, goalId: number, balanceCents: number, note?: string): Promise<Goal> {
  const g = await getGoal(ctx, goalId);
  const diff = balanceCents - g.balance_cents;
  if (diff !== 0) await addGoalEntry(ctx, goalId, { kind: "adjustment", amount_cents: diff, note: note ?? "Atualização de saldo" });
  return getGoal(ctx, goalId);
}

/** "Dar check" no aporte do mês: lança o que falta do aporte planejado. */
export async function checkGoalMonth(ctx: Ctx, goalId: number, month: string, amountCents?: number): Promise<Goal> {
  const g = await getGoal(ctx, goalId, month);
  const amount = amountCents ?? g.month_planned_cents - g.month_contrib_cents;
  if (amount <= 0) throw new UserError(`O aporte de ${g.name} neste mês já foi feito`, 409);
  const date = month === ctx.month ? ctx.today : `${month}-01`;
  await addGoalEntry(ctx, goalId, { kind: "contribution", amount_cents: amount, month, date });
  return getGoal(ctx, goalId, month);
}

export async function resolveGoal(ctx: Ctx, name: string): Promise<Goal> {
  return findByName(await listGoals(ctx, ctx.month), name, (g) => [g.name, ...(g.institution ? [g.institution] : [])], "Meta");
}

// ---------- metas em conjunto ----------

/** Define quem participa da meta (só quem criou; só pessoas conectadas). Quem sai continua com as movimentações que fez. */
export async function setGoalMembers(ctx: Ctx, goalId: number, userIds: number[]): Promise<Goal> {
  await ownGoal(ctx, goalId);
  const ids = [...new Set(userIds)].filter((u) => u !== ctx.userId);
  if (ids.length) {
    const connected = new Set((await listConnections(ctx)).map((c) => c.user_id));
    if (ids.some((u) => !connected.has(u))) throw new UserError("Só dá para compartilhar metas com pessoas conectadas a você", 404);
  }
  await ctx.db.batch([
    ctx.db
      .prepare(
        `DELETE FROM goal_members WHERE goal_id = ?1 AND user_id <> ?2 ${ids.length ? `AND user_id NOT IN (${ids.map(() => "?").join(", ")})` : ""}
         AND EXISTS (SELECT 1 FROM goals WHERE id = ?1 AND user_id = ?2)`,
      )
      .bind(goalId, ctx.userId, ...ids),
    ...ids.map((u) =>
      ctx.db.prepare("INSERT OR IGNORE INTO goal_members (goal_id, user_id) SELECT g.id, ? FROM goals g WHERE g.id = ? AND g.user_id = ?").bind(u, goalId, ctx.userId),
    ),
  ]);
  return getGoal(ctx, goalId);
}

/** Sair de uma meta em conjunto de outra pessoa. As movimentações que você fez continuam no saldo dela. */
export async function leaveGoal(ctx: Ctx, goalId: number): Promise<void> {
  const res = await ctx.db.prepare("DELETE FROM goal_members WHERE goal_id = ? AND user_id = ?").bind(goalId, ctx.userId).run();
  if (!res.meta.changes) throw new UserError("Você não participa desta meta", 404);
}

export const MyPlanInput = z.object({ monthly_cents: z.number().int().positive().nullable() });

/** Seu aporte mensal planejado na meta (quem criou: o da meta; quem participa: o seu). */
export async function setMyPlan(ctx: Ctx, goalId: number, input: z.input<typeof MyPlanInput>): Promise<Goal> {
  const { monthly_cents } = MyPlanInput.parse(input);
  const g = await getGoal(ctx, goalId);
  if (g.owner) {
    await ctx.db.prepare("UPDATE goal_members SET monthly_cents = ? WHERE goal_id = ? AND user_id = ?").bind(monthly_cents, goalId, ctx.userId).run();
  } else {
    await updateRow(ctx, "goals", goalId, { monthly_cents }, ["monthly_cents"]);
  }
  return getGoal(ctx, goalId);
}

