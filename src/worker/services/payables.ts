// "Devo": o que você deve a pessoas conectadas. As linhas são das outras pessoas (receivables de quem tem a receber,
// com debtor_user_id = você); aqui você só vê o necessário e pode marcar "paguei" ou contestar.
// Elas contam nos seus gastos no mês do item (o mesmo mês em que entram na fatura de quem passou no cartão).
import { z } from "zod";
import type { Payable } from "../../shared/connections";
import { isDue } from "../../shared/receivables";
import { DATE_RE } from "../../shared/month";
import { type Ctx, UserError } from "../lib";

const COLS = `r.id, r.user_id AS creditor_id, u.name AS creditor_name, r.description, r.amount_cents, r.date, r.month,
  r.installment_no, r.installment_total, r.received_at, r.paid_claimed_at, r.disputed_at, r.dispute_note`;

type Row = Payable & { installment_group: string | null };
const strip = ({ installment_group: _, ...p }: Row): Payable => p;

export interface PayableFilter {
  /** Padrão: pendentes (ainda não recebidos por quem tem a receber). */
  status?: "pending" | "received" | "all";
  creditor_id?: number;
  /** Mês de referência para "já venceu" (padrão: mês atual). */
  refMonth?: string;
}

export async function listPayables(ctx: Ctx, f: PayableFilter = {}): Promise<(Payable & { due: boolean })[]> {
  const where = ["r.debtor_user_id = ?"];
  const args: number[] = [ctx.userId];
  const status = f.status ?? "pending";
  if (status === "pending") where.push("r.received_at IS NULL");
  if (status === "received") where.push("r.received_at IS NOT NULL");
  if (f.creditor_id) (where.push("r.user_id = ?"), args.push(f.creditor_id));
  const rows = await ctx.db
    .prepare(
      `SELECT ${COLS}, r.installment_group FROM receivables r JOIN users u ON u.id = r.user_id
       WHERE ${where.join(" AND ")} ORDER BY r.date DESC, r.id DESC LIMIT 1000`,
    )
    .bind(...args)
    .all<Row>();
  return rows.results.map((r) => ({ ...strip(r), due: isDue(r, f.refMonth ?? ctx.month) }));
}

/** Soma do que você deve por mês (entra nos seus gastos). */
export async function payablesByMonth(ctx: Ctx): Promise<Map<string, number>> {
  const rows = await ctx.db
    .prepare("SELECT month, SUM(amount_cents) AS total FROM receivables WHERE debtor_user_id = ? GROUP BY month")
    .bind(ctx.userId)
    .all<{ month: string; total: number }>();
  return new Map(rows.results.map((r) => [r.month, r.total]));
}

export const MarkPaidInput = z.object({
  ids: z.array(z.number().int()).optional(),
  /** Todos os pendentes já vencidos com esta pessoa. */
  creditor_id: z.number().int().optional(),
  date: z.string().regex(DATE_RE).optional(),
  undo: z.boolean().optional(),
});

/** Marca "paguei" (fica aguardando a confirmação de quem tem a receber) ou desfaz. */
export async function markPaid(ctx: Ctx, input: z.input<typeof MarkPaidInput>): Promise<Payable[]> {
  const p = MarkPaidInput.parse(input);
  let targets: (Payable & { due: boolean })[];
  if (p.ids?.length) {
    const mine = new Map((await listPayables(ctx)).map((x) => [x.id, x]));
    targets = p.ids.map((id) => {
      const t = mine.get(id);
      if (!t) throw new UserError(`Dívida ${id} não encontrada (ou já recebida)`, 404);
      return t;
    });
  } else if (p.creditor_id) {
    targets = (await listPayables(ctx, { creditor_id: p.creditor_id })).filter((t) => t.due && (p.undo ? !!t.paid_claimed_at : !t.paid_claimed_at));
  } else throw new UserError("Informe os itens ou a pessoa");
  if (!targets.length) return [];
  const value = p.undo ? null : (p.date ?? ctx.today);
  await ctx.db.batch(
    targets.map((t) =>
      ctx.db
        .prepare("UPDATE receivables SET paid_claimed_at = ? WHERE id = ? AND debtor_user_id = ? AND received_at IS NULL")
        .bind(value, t.id, ctx.userId),
    ),
  );
  return targets.map(({ due: _, ...t }) => ({ ...t, paid_claimed_at: value }));
}

export const DisputeInput = z.object({ note: z.string().trim().min(1).max(300) });

/** Contesta um item (ex.: "esse valor não é meu"). Quem tem a receber vê o motivo. */
export async function disputePayable(ctx: Ctx, id: number, input: z.input<typeof DisputeInput> | null): Promise<void> {
  const note = input ? DisputeInput.parse(input).note : null;
  const res = await ctx.db
    .prepare(
      `UPDATE receivables SET disputed_at = ${note ? "datetime('now')" : "NULL"}, dispute_note = ?
       WHERE id = ? AND debtor_user_id = ? AND received_at IS NULL`,
    )
    .bind(note, id, ctx.userId)
    .run();
  if (!res.meta.changes) throw new UserError(`Dívida ${id} não encontrada (ou já recebida)`, 404);
}
