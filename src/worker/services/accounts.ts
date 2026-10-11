import { z } from "zod";
import type { Account } from "../../shared/types";
import { type Ctx, findByName, mustGet, nn, updateRow, UserError } from "../lib";

const day = z.number().int().min(1).max(31).nullable();

export const AccountInput = z.object({
  name: z.string().trim().min(1),
  type: z.enum(["credit", "debit", "pix", "cash", "voucher", "other"]).default("credit"),
  closing_day: day.optional(),
  due_day: day.optional(),
  payment_day: day.optional(),
  color: z.string().nullable().optional(),
});
// Sem o default de `type`: uma edição parcial não pode trocar o tipo da conta sem querer
export const AccountPatch = AccountInput.extend({ type: z.enum(["credit", "debit", "pix", "cash", "voucher", "other"]) })
  .partial()
  .extend({ archived: z.boolean().optional() });

export async function listAccounts(ctx: Ctx, includeArchived = false): Promise<Account[]> {
  const sql = `SELECT id, name, type, closing_day, due_day, payment_day, color, archived FROM accounts
               ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY archived, name COLLATE NOCASE`;
  return (await ctx.db.prepare(sql).all<Account>()).results;
}

export async function getAccount(ctx: Ctx, id: number): Promise<Account> {
  return mustGet<Account>(ctx.db, "accounts", id, "Conta");
}

export async function createAccount(ctx: Ctx, input: z.input<typeof AccountInput>): Promise<Account> {
  const a = AccountInput.parse(input);
  const row = await ctx.db
    .prepare(
      `INSERT INTO accounts (name, type, closing_day, due_day, payment_day, color) VALUES (?, ?, ?, ?, ?, ?)
       RETURNING id, name, type, closing_day, due_day, payment_day, color, archived`,
    )
    .bind(a.name, a.type, nn(a.closing_day), nn(a.due_day), nn(a.payment_day), nn(a.color))
    .first<Account>();
  return row!;
}

export async function updateAccount(ctx: Ctx, id: number, patch: z.input<typeof AccountPatch>): Promise<Account> {
  const p = AccountPatch.parse(patch);
  await updateRow(ctx.db, "accounts", id, p, ["name", "type", "closing_day", "due_day", "payment_day", "color", "archived"]);
  return getAccount(ctx, id);
}

/** Exclui a conta; se houver lançamentos ligados a ela, apenas arquiva para preservar o histórico. */
export async function deleteAccount(ctx: Ctx, id: number): Promise<{ archived: boolean }> {
  const used = await ctx.db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM expenses WHERE account_id = ?1) + (SELECT COUNT(*) FROM installments WHERE account_id = ?1)
            + (SELECT COUNT(*) FROM recurring WHERE account_id = ?1) + (SELECT COUNT(*) FROM receivables WHERE account_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if (used && used.n > 0) {
    await updateRow(ctx.db, "accounts", id, { archived: 1 }, ["archived"]);
    return { archived: true };
  }
  const res = await ctx.db.prepare("DELETE FROM accounts WHERE id = ?").bind(id).run();
  if (!res.meta.changes) throw new UserError(`Conta ${id} não encontrada`, 404);
  return { archived: false };
}

const TYPE_ALIASES: Record<string, string[]> = {
  pix: ["pix"],
  voucher: ["vr", "va", "vale", "vale refeicao", "vale alimentacao", "ticket", "alelo", "sodexo", "flash", "caju"],
  cash: ["dinheiro", "especie"],
  debit: ["debito"],
  credit: [],
  other: [],
};

/** Resolve uma conta pelo nome ("nubank", "cartão inter", "vr", "pix"...). */
export async function resolveAccount(ctx: Ctx, name: string): Promise<Account> {
  const accounts = await listAccounts(ctx);
  const cleaned = name.replace(/^(cart[aã]o|conta)\s+(de\s+cr[eé]dito\s+)?(do\s+|da\s+)?/i, "").trim() || name;
  return findByName(accounts, cleaned, (a) => [a.name, ...TYPE_ALIASES[a.type]], "Conta/cartão");
}
