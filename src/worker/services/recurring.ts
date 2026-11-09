import { z } from "zod";
import { addMonths, MONTH_RE } from "../../shared/month";
import type { Recurring, Split } from "../../shared/types";
import { type Ctx, findByName, mustGet, nn, updateRow, UserError } from "../lib";
import { SplitInput } from "./expenses";
import { canonicalPerson, syncRecurringSplits } from "./receivables";

export const RecurringInput = z.object({
  description: z.string().trim().min(1),
  amount_cents: z.number().int().nonnegative(),
  account_id: z.number().int().nullable().optional(),
  is_budget: z.boolean().optional(),
  day: z.number().int().min(1).max(31).nullable().optional(),
  start_month: z.string().regex(MONTH_RE).optional(),
  end_month: z.string().regex(MONTH_RE).nullable().optional(),
  /**
   * Fixo dividido: parte de cada pessoa por mês (todo mês vira um devedor). Ao criar, `amount_cents` é o valor TOTAL
   * e o fixo fica só com a sua parte; ao editar, `amount_cents` é a sua parte e `splits` substitui a divisão ([] = desfaz).
   */
  splits: z.array(SplitInput).optional(),
});
export const RecurringPatch = RecurringInput.partial();

export const RecurringMonthInput = z.object({
  /** null remove o ajuste e volta ao valor padrão */
  amount_cents: z.number().int().nonnegative().nullable().optional(),
  paid: z.boolean().optional(),
});

const SELECT = `SELECT r.id, r.description, r.amount_cents, r.account_id, r.is_budget, r.day, r.start_month, r.end_month,
  COALESCE(rm.amount_cents, r.amount_cents) AS month_amount_cents,
  rm.amount_cents IS NOT NULL AS overridden,
  COALESCE(rm.paid, 0) AS paid,
  CASE WHEN r.is_budget = 1 THEN COALESCE((SELECT SUM(e.amount_cents) FROM expenses e WHERE e.budget_id = r.id AND e.month = ?1 AND e.user_id = r.user_id), 0) ELSE 0 END AS spent_cents,
  (SELECT json_group_array(json_object('person', s.person, 'amount_cents', s.amount_cents)) FROM recurring_splits s WHERE s.recurring_id = r.id AND s.user_id = r.user_id) AS splits_json
  FROM recurring r LEFT JOIN recurring_months rm ON rm.recurring_id = r.id AND rm.month = ?1 AND rm.user_id = r.user_id`;
// ?1 = mês, ?2 = dono, ?3 = id

type Row = Omit<Recurring, "overridden" | "paid" | "splits" | "shared_cents"> & { overridden: number; paid: number; splits_json: string | null };
function decorate({ splits_json, ...r }: Row): Recurring {
  const splits: Split[] = splits_json ? JSON.parse(splits_json) : [];
  return { ...r, overridden: !!r.overridden, paid: !!r.paid, splits, shared_cents: splits.reduce((s, x) => s + x.amount_cents, 0) };
}

/**
 * Define com quem o fixo é dividido. Quem já estava mantém os meses gerados; o devedor deste mês (se ainda não recebido)
 * acompanha o novo valor ou sai junto com a pessoa. Os meses anteriores ficam como estão em Devedores.
 */
async function setSplits(ctx: Ctx, id: number, startMonth: string, input: z.infer<typeof SplitInput>[]): Promise<void> {
  const byPerson = new Map<string, number>();
  for (const s of input) {
    const person = await canonicalPerson(ctx, s.person);
    byPerson.set(person, (byPerson.get(person) ?? 0) + s.amount_cents);
  }
  const current = (
    await ctx.db.prepare("SELECT person FROM recurring_splits WHERE recurring_id = ? AND user_id = ?").bind(id, ctx.userId).all<{ person: string }>()
  ).results;
  // Pessoa nova: começa no mês atual (ou no início do fixo, se ainda vai começar)
  const through = addMonths(startMonth > ctx.month ? startMonth : ctx.month, -1);
  const stmts: D1PreparedStatement[] = [];
  for (const { person } of current) {
    if (byPerson.has(person)) continue;
    stmts.push(
      ctx.db.prepare("DELETE FROM recurring_splits WHERE recurring_id = ? AND person = ? AND user_id = ?").bind(id, person, ctx.userId),
      ctx.db
        .prepare("DELETE FROM receivables WHERE recurring_id = ? AND person = ? AND month = ? AND received_at IS NULL AND user_id = ?")
        .bind(id, person, ctx.month, ctx.userId),
    );
  }
  for (const [person, amount] of byPerson) {
    stmts.push(
      ctx.db
        .prepare(
          `INSERT INTO recurring_splits (user_id, recurring_id, person, amount_cents, generated_through) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (recurring_id, person) DO UPDATE SET amount_cents = excluded.amount_cents`,
        )
        .bind(ctx.userId, id, person, amount, through),
      ctx.db
        .prepare("UPDATE receivables SET amount_cents = ? WHERE recurring_id = ? AND person = ? AND month = ? AND received_at IS NULL AND user_id = ?")
        .bind(amount, id, person, ctx.month, ctx.userId),
    );
  }
  if (stmts.length) await ctx.db.batch(stmts);
  await syncRecurringSplits(ctx, true);
}

/** Fixos ativos no mês (ou todos, com `all`), com o valor efetivo daquele mês. */
export async function listRecurring(ctx: Ctx, month: string, all = false): Promise<Recurring[]> {
  const active = all ? "" : "AND r.start_month <= ?1 AND (r.end_month IS NULL OR r.end_month >= ?1)";
  const sql = `${SELECT} WHERE r.user_id = ?2 ${active} ORDER BY r.is_budget, r.description COLLATE NOCASE`;
  return (await ctx.db.prepare(sql).bind(month, ctx.userId).all<Row>()).results.map(decorate);
}

export async function getRecurring(ctx: Ctx, id: number, month = ctx.month): Promise<Recurring> {
  const row = await ctx.db.prepare(`${SELECT} WHERE r.user_id = ?2 AND r.id = ?3`).bind(month, ctx.userId, id).first<Row>();
  if (!row) throw new UserError(`Fixo ${id} não encontrado`, 404);
  return decorate(row);
}

export async function createRecurring(ctx: Ctx, input: z.input<typeof RecurringInput>): Promise<Recurring> {
  const r = RecurringInput.parse(input);
  if (r.account_id) await mustGet(ctx, "accounts", r.account_id, "Conta");
  const splits = r.splits ?? [];
  if (splits.length && r.is_budget) throw new UserError("Orçamento não é dividido: divida os gastos lançados nele");
  const mine = r.amount_cents - splits.reduce((s, x) => s + x.amount_cents, 0);
  if (mine < 0) throw new UserError("A soma das partes dos outros é maior que o valor total");
  const row = await ctx.db
    .prepare(
      `INSERT INTO recurring (user_id, description, amount_cents, account_id, is_budget, day, start_month, end_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.userId, r.description, mine, nn(r.account_id), r.is_budget ? 1 : 0, nn(r.day), r.start_month ?? ctx.month, nn(r.end_month))
    .first<{ id: number }>();
  if (splits.length) await setSplits(ctx, row!.id, r.start_month ?? ctx.month, splits);
  return getRecurring(ctx, row!.id, r.start_month ?? ctx.month);
}

export async function updateRecurring(ctx: Ctx, id: number, patch: z.input<typeof RecurringPatch>): Promise<Recurring> {
  const p = RecurringPatch.parse(patch);
  if (p.account_id) await mustGet(ctx, "accounts", p.account_id, "Conta");
  const cur = await getRecurring(ctx, id);
  if ((p.splits ?? cur.splits).length && (p.is_budget ?? !!cur.is_budget)) throw new UserError("Orçamento não é dividido: divida os gastos lançados nele");
  await updateRow(ctx, "recurring", id, p, ["description", "amount_cents", "account_id", "is_budget", "day", "start_month", "end_month"]);
  if (p.splits) await setSplits(ctx, id, p.start_month ?? cur.start_month, p.splits);
  return getRecurring(ctx, id);
}

export async function deleteRecurring(ctx: Ctx, id: number): Promise<Recurring> {
  const cur = await getRecurring(ctx, id);
  // O que as pessoas já devem dos meses passados continua em Devedores; só a divisão dos próximos meses acaba
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM recurring_splits WHERE recurring_id = ? AND user_id = ?").bind(id, ctx.userId),
    ctx.db.prepare("DELETE FROM recurring WHERE id = ? AND user_id = ?").bind(id, ctx.userId),
  ]);
  return cur;
}

/** Ajusta o valor de um fixo só em um mês (ex.: conta de luz) e/ou marca como pago. */
export async function setRecurringMonth(
  ctx: Ctx,
  id: number,
  month: string,
  input: z.input<typeof RecurringMonthInput>,
): Promise<Recurring> {
  const p = RecurringMonthInput.parse(input);
  await getRecurring(ctx, id, month);
  const existing = await ctx.db
    .prepare("SELECT amount_cents, paid FROM recurring_months WHERE recurring_id = ? AND month = ? AND user_id = ?")
    .bind(id, month, ctx.userId)
    .first<{ amount_cents: number | null; paid: number }>();
  const amount = p.amount_cents !== undefined ? p.amount_cents : (existing?.amount_cents ?? null);
  const paid = p.paid !== undefined ? (p.paid ? 1 : 0) : (existing?.paid ?? 0);
  if (amount === null && !paid) {
    await ctx.db.prepare("DELETE FROM recurring_months WHERE recurring_id = ? AND month = ? AND user_id = ?").bind(id, month, ctx.userId).run();
  } else {
    await ctx.db
      .prepare(
        `INSERT INTO recurring_months (user_id, recurring_id, month, amount_cents, paid) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (recurring_id, month) DO UPDATE SET amount_cents = excluded.amount_cents, paid = excluded.paid`,
      )
      .bind(ctx.userId, id, month, amount, paid)
      .run();
  }
  return getRecurring(ctx, id, month);
}

export async function resolveRecurring(ctx: Ctx, name: string, opts: { budgetOnly?: boolean; month?: string } = {}) {
  const items = (await listRecurring(ctx, opts.month ?? ctx.month)).filter((r) => !opts.budgetOnly || r.is_budget);
  return findByName(items, name, (r) => [r.description], opts.budgetOnly ? "Orçamento" : "Fixo");
}
