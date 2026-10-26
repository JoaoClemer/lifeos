import { z } from "zod";
import { DATE_RE, MONTH_RE, referenceMonth } from "../../shared/month";
import type { Account, Expense } from "../../shared/types";
import { type Ctx, mustGet, nn, updateRow, UserError } from "../lib";
import { canonicalPerson, debtorFor } from "./receivables";

const cents = z.number().int();

export const SplitInput = z.object({
  person: z.string().trim().min(1),
  amount_cents: cents.positive(),
});

export const ExpenseInput = z.object({
  description: z.string().trim().min(1),
  /** Valor TOTAL da compra. Se houver `splits`, sua parte = total - soma das partes dos outros. */
  amount_cents: cents.positive(),
  date: z.string().regex(DATE_RE).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  account_id: z.number().int().nullable().optional(),
  budget_id: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
  splits: z.array(SplitInput).optional(),
});

export const ExpensePatch = z.object({
  description: z.string().trim().min(1).optional(),
  amount_cents: cents.positive().optional(),
  date: z.string().regex(DATE_RE).optional(),
  month: z.string().regex(MONTH_RE).optional(),
  account_id: z.number().int().nullable().optional(),
  budget_id: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const SELECT = `SELECT e.id, e.description, e.amount_cents, e.date, e.month, e.account_id, e.budget_id, e.notes,
  COALESCE((SELECT SUM(r.amount_cents) FROM receivables r WHERE r.expense_id = e.id AND r.user_id = e.user_id), 0) AS shared_cents
  FROM expenses e`;

export interface ExpenseFilter {
  month?: string;
  /** Data da compra ('YYYY-MM-DD'), independente do mês da fatura. */
  date?: string;
  account_id?: number;
  budget_id?: number;
  search?: string;
  limit?: number;
}

export async function listExpenses(ctx: Ctx, f: ExpenseFilter): Promise<Expense[]> {
  const where: string[] = ["e.user_id = ?"];
  const args: (string | number)[] = [ctx.userId];
  if (f.month) (where.push("e.month = ?"), args.push(f.month));
  if (f.date) (where.push("e.date = ?"), args.push(f.date));
  if (f.account_id) (where.push("e.account_id = ?"), args.push(f.account_id));
  if (f.budget_id) (where.push("e.budget_id = ?"), args.push(f.budget_id));
  if (f.search) (where.push("e.description LIKE ?"), args.push(`%${f.search}%`));
  const sql = `${SELECT} WHERE ${where.join(" AND ")}
    ORDER BY e.date DESC, e.id DESC LIMIT ${Math.min(f.limit ?? 500, 2000)}`;
  return (await ctx.db.prepare(sql).bind(...args).all<Expense>()).results;
}

export async function getExpense(ctx: Ctx, id: number): Promise<Expense> {
  const row = await ctx.db.prepare(`${SELECT} WHERE e.id = ? AND e.user_id = ?`).bind(id, ctx.userId).first<Expense>();
  if (!row) throw new UserError(`Lançamento ${id} não encontrado`, 404);
  return row;
}

async function accountOrNull(ctx: Ctx, id: number | null | undefined): Promise<Account | null> {
  return id ? mustGet<Account>(ctx, "accounts", id, "Conta") : null;
}

async function checkBudget(ctx: Ctx, budgetId: number | null | undefined) {
  if (!budgetId) return;
  const b = await ctx.db
    .prepare("SELECT is_budget FROM recurring WHERE id = ? AND user_id = ?")
    .bind(budgetId, ctx.userId)
    .first<{ is_budget: number }>();
  if (!b) throw new UserError(`Orçamento ${budgetId} não encontrado`, 404);
  if (!b.is_budget) throw new UserError(`O fixo ${budgetId} não é um orçamento`);
}

export interface CreatedExpense {
  expense: Expense | null;
  receivable_ids: number[];
  my_share_cents: number;
  month: string;
}

/**
 * Lança um gasto avulso. Se `splits` for informado, cria devedores (no mesmo cartão/mês)
 * para a parte de cada pessoa e o gasto fica só com a sua parte.
 */
export async function createExpense(ctx: Ctx, input: z.input<typeof ExpenseInput>): Promise<CreatedExpense> {
  const e = ExpenseInput.parse(input);
  const date = e.date ?? ctx.today;
  const account = await accountOrNull(ctx, e.account_id);
  await checkBudget(ctx, e.budget_id);
  const month = e.month ?? referenceMonth(date, account);
  const splits = await Promise.all(
    (e.splits ?? []).map(async (s) => {
      const person = await canonicalPerson(ctx, s.person);
      return { ...s, person, debtor: await debtorFor(ctx, person) };
    }),
  );
  const othersTotal = splits.reduce((s, x) => s + x.amount_cents, 0);
  const myShare = e.amount_cents - othersTotal;
  if (myShare < 0) throw new UserError("A soma das partes dos outros é maior que o valor total");

  const stmts: D1PreparedStatement[] = [];
  if (myShare > 0) {
    stmts.push(
      ctx.db
        .prepare(
          `INSERT INTO expenses (user_id, description, amount_cents, date, month, account_id, budget_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(ctx.userId, e.description, myShare, date, month, account?.id ?? null, nn(e.budget_id), nn(e.notes)),
    );
  }
  for (const s of splits) {
    stmts.push(
      ctx.db
        .prepare(
          `INSERT INTO receivables (user_id, person, description, amount_cents, date, month, account_id, debtor_user_id, expense_id)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ${myShare > 0 ? "(SELECT MAX(id) FROM expenses WHERE user_id = ?1)" : "NULL"}) RETURNING id`,
        )
        .bind(ctx.userId, s.person, e.description, s.amount_cents, date, month, account?.id ?? null, s.debtor),
    );
  }
  // batch = transação: o gasto e as partes dos outros entram juntos
  const results = await ctx.db.batch<{ id: number }>(stmts);
  const expenseId = myShare > 0 ? results[0].meta.last_row_id : null;
  const receivableIds = results.slice(myShare > 0 ? 1 : 0).map((r) => r.results[0].id);
  return {
    expense: expenseId ? await getExpense(ctx, expenseId) : null,
    receivable_ids: receivableIds,
    my_share_cents: myShare,
    month,
  };
}

export async function updateExpense(ctx: Ctx, id: number, patch: z.input<typeof ExpensePatch>): Promise<Expense> {
  const p = ExpensePatch.parse(patch);
  const current = await getExpense(ctx, id);
  if (p.account_id) await accountOrNull(ctx, p.account_id);
  if (p.budget_id !== undefined) await checkBudget(ctx, p.budget_id);
  // Se mudou data ou conta e o mês não foi informado, recalcula o mês da fatura
  if (p.month === undefined && (p.date !== undefined || p.account_id !== undefined)) {
    const account = await accountOrNull(ctx, p.account_id !== undefined ? p.account_id : current.account_id);
    p.month = referenceMonth(p.date ?? current.date, account);
  }
  await updateRow(ctx, "expenses", id, p, ["description", "amount_cents", "date", "month", "account_id", "budget_id", "notes"]);
  return getExpense(ctx, id);
}

/** Exclui o gasto e os devedores ainda não recebidos que vieram da divisão dele. */
export async function deleteExpense(ctx: Ctx, id: number): Promise<Expense> {
  const current = await getExpense(ctx, id);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM receivables WHERE expense_id = ? AND user_id = ? AND received_at IS NULL").bind(id, ctx.userId),
    ctx.db.prepare("DELETE FROM expenses WHERE id = ? AND user_id = ?").bind(id, ctx.userId),
  ]);
  return current;
}
