import { z } from "zod";
import { addMonths, DATE_RE, monthDiff, MONTH_RE, referenceMonth } from "../../shared/month";
import type { Account, Installment } from "../../shared/types";
import { type Ctx, mustGet, nn, updateRow, UserError } from "../lib";

export const InstallmentInput = z
  .object({
    description: z.string().trim().min(1),
    installment_cents: z.number().int().positive().optional(),
    total_cents: z.number().int().positive().optional(),
    total_installments: z.number().int().min(1).max(120),
    account_id: z.number().int().nullable().optional(),
    purchase_date: z.string().regex(DATE_RE).optional(),
    /** Mês (fatura) da 1ª parcela. Se omitido, é calculado. */
    first_month: z.string().regex(MONTH_RE).optional(),
    /** Para cadastrar algo que você já está pagando: parcela atual no mês `reference_month` (padrão: mês atual). */
    current_installment: z.number().int().min(1).optional(),
    reference_month: z.string().regex(MONTH_RE).optional(),
  })
  .refine((v) => v.installment_cents || v.total_cents, { message: "Informe o valor da parcela ou o valor total" });

export const InstallmentPatch = z.object({
  description: z.string().trim().min(1).optional(),
  installment_cents: z.number().int().positive().optional(),
  total_installments: z.number().int().min(1).max(120).optional(),
  first_month: z.string().regex(MONTH_RE).optional(),
  account_id: z.number().int().nullable().optional(),
  purchase_date: z.string().regex(DATE_RE).nullable().optional(),
});

interface Row extends Omit<Installment, "current" | "remaining_cents"> {}

function decorate(row: Row, month: string): Installment {
  const current = monthDiff(row.first_month, month) + 1;
  const paidThrough = Math.min(Math.max(current, 0), row.total_installments);
  return { ...row, current, remaining_cents: (row.total_installments - paidThrough) * row.installment_cents };
}

const COLS = "id, description, installment_cents, total_installments, first_month, last_month, account_id, purchase_date";

/** Parcelados ativos no mês (ou todos, com `all`). */
export async function listInstallments(ctx: Ctx, month: string, all = false): Promise<Installment[]> {
  const sql = all
    ? `SELECT ${COLS} FROM installments WHERE user_id = ?2 ORDER BY last_month DESC, description COLLATE NOCASE`
    : `SELECT ${COLS} FROM installments WHERE user_id = ?2 AND first_month <= ?1 AND last_month >= ?1 ORDER BY last_month, description COLLATE NOCASE`;
  const stmt = ctx.db.prepare(sql).bind(month, ctx.userId);
  return (await stmt.all<Row>()).results.map((r) => decorate(r, month));
}

export async function getInstallment(ctx: Ctx, id: number, month = ctx.month): Promise<Installment> {
  const row = await ctx.db.prepare(`SELECT ${COLS} FROM installments WHERE id = ? AND user_id = ?`).bind(id, ctx.userId).first<Row>();
  if (!row) throw new UserError(`Parcelado ${id} não encontrado`, 404);
  return decorate(row, month);
}

export async function createInstallment(ctx: Ctx, input: z.input<typeof InstallmentInput>): Promise<Installment> {
  const i = InstallmentInput.parse(input);
  const n = i.total_installments;
  const value = i.installment_cents ?? Math.round(i.total_cents! / n);
  const account = i.account_id ? await mustGet<Account>(ctx, "accounts", i.account_id, "Conta") : null;
  let first: string;
  if (i.first_month) first = i.first_month;
  else if (i.current_installment) {
    if (i.current_installment > n) throw new UserError("Parcela atual maior que o total de parcelas");
    first = addMonths(i.reference_month ?? ctx.month, -(i.current_installment - 1));
  } else first = referenceMonth(i.purchase_date ?? ctx.today, account);
  const row = await ctx.db
    .prepare(
      `INSERT INTO installments (user_id, description, installment_cents, total_installments, first_month, last_month, account_id, purchase_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(ctx.userId, i.description, value, n, first, addMonths(first, n - 1), account?.id ?? null, nn(i.purchase_date))
    .first<{ id: number }>();
  return getInstallment(ctx, row!.id, i.reference_month ?? ctx.month);
}

export async function updateInstallment(ctx: Ctx, id: number, patch: z.input<typeof InstallmentPatch>): Promise<Installment> {
  const p = InstallmentPatch.parse(patch);
  const cur = await getInstallment(ctx, id);
  if (p.account_id) await mustGet(ctx, "accounts", p.account_id, "Conta");
  const first = p.first_month ?? cur.first_month;
  const n = p.total_installments ?? cur.total_installments;
  await updateRow(
    ctx,
    "installments",
    id,
    { ...p, last_month: addMonths(first, n - 1) },
    ["description", "installment_cents", "total_installments", "first_month", "last_month", "account_id", "purchase_date"],
  );
  return getInstallment(ctx, id);
}

export async function deleteInstallment(ctx: Ctx, id: number): Promise<Installment> {
  const cur = await getInstallment(ctx, id);
  await ctx.db.prepare("DELETE FROM installments WHERE id = ? AND user_id = ?").bind(id, ctx.userId).run();
  return cur;
}
