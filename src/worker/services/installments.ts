import { z } from "zod";
import { addMonths, DATE_RE, monthDiff, MONTH_RE, referenceMonth } from "../../shared/month";
import type { Account, Installment } from "../../shared/types";
import { type Ctx, mustGet, nn, updateRow, UserError } from "../lib";
import { SplitInput } from "./expenses";
import { createReceivable } from "./receivables";

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
    /**
     * Compra dividida: parte de cada pessoa, na mesma base do valor informado (da parcela, com `installment_cents`;
     * do total, com `total_cents`). O valor informado é o da compra toda; o parcelado fica só com a sua parte.
     */
    splits: z.array(SplitInput).optional(),
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

// ?1 = mês, ?2 = dono, ?3 = id
const SELECT = `SELECT i.id, i.description, i.installment_cents, i.total_installments, i.first_month, i.last_month, i.account_id, i.purchase_date,
  COALESCE((SELECT SUM(rc.amount_cents) / COUNT(DISTINCT rc.month) FROM receivables rc WHERE rc.installment_id = i.id AND rc.user_id = i.user_id), 0) AS shared_cents
  FROM installments i`;

/** Parcelados ativos no mês (ou todos, com `all`). */
export async function listInstallments(ctx: Ctx, month: string, all = false): Promise<Installment[]> {
  const sql = all
    ? `${SELECT} WHERE i.user_id = ?2 ORDER BY i.last_month DESC, i.description COLLATE NOCASE`
    : `${SELECT} WHERE i.user_id = ?2 AND i.first_month <= ?1 AND i.last_month >= ?1 ORDER BY i.last_month, i.description COLLATE NOCASE`;
  const stmt = ctx.db.prepare(sql).bind(month, ctx.userId);
  return (await stmt.all<Row>()).results.map((r) => decorate(r, month));
}

export async function getInstallment(ctx: Ctx, id: number, month = ctx.month): Promise<Installment> {
  const row = await ctx.db.prepare(`${SELECT} WHERE i.user_id = ?2 AND i.id = ?3`).bind(month, ctx.userId, id).first<Row>();
  if (!row) throw new UserError(`Parcelado ${id} não encontrado`, 404);
  return decorate(row, month);
}

export async function createInstallment(ctx: Ctx, input: z.input<typeof InstallmentInput>): Promise<Installment> {
  const i = InstallmentInput.parse(input);
  const n = i.total_installments;
  const splits = i.splits ?? [];
  const others = splits.reduce((s, x) => s + x.amount_cents, 0);
  const mine = (i.installment_cents ?? i.total_cents!) - others;
  if (mine < 0) throw new UserError("A soma das partes dos outros é maior que o valor da compra");
  if (mine === 0) throw new UserError("Sem a sua parte não há parcelado: registre um devedor parcelado para a pessoa");
  const value = i.installment_cents ? mine : Math.round(mine / n);
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
  // A parte de cada pessoa vira devedor parcelado, nos mesmos meses e no mesmo cartão
  for (const s of splits) {
    await createReceivable(
      ctx,
      {
        person: s.person,
        description: i.description,
        ...(i.installment_cents ? { amount_cents: s.amount_cents } : { total_cents: s.amount_cents }),
        installments: n,
        date: i.purchase_date,
        account_id: account?.id ?? null,
        ...(i.current_installment && n > 1 && !i.first_month
          ? { current_installment: i.current_installment, month: i.reference_month ?? ctx.month }
          : { month: first }),
      },
      row!.id,
    );
  }
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

/** Exclui o parcelado e as parcelas ainda não recebidas das pessoas com quem ele foi dividido. */
export async function deleteInstallment(ctx: Ctx, id: number): Promise<Installment> {
  const cur = await getInstallment(ctx, id);
  await ctx.db.batch([
    ctx.db.prepare("DELETE FROM receivables WHERE installment_id = ? AND user_id = ? AND received_at IS NULL").bind(id, ctx.userId),
    ctx.db.prepare("DELETE FROM installments WHERE id = ? AND user_id = ?").bind(id, ctx.userId),
  ]);
  return cur;
}
