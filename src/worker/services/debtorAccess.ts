import { type DebtorItem, type DebtorStatement, isDue, personKey } from "../../shared/receivables";
import type { Ctx } from "../lib";
import { listPeople } from "./receivables";

// Acesso de devedores: quem tem a variável DEBTOR_CODE_<NOME> (wrangler secret) aparece em /devedor
// e, com o código, vê só os próprios valores.

const PREFIX = "DEBTOR_CODE_";
/** Códigos mais curtos que isso são ignorados (a pessoa nem aparece na lista): curtos demais para adivinhar. */
export const MIN_CODE_LENGTH = 6;

/** Códigos configurados: chave da pessoa (ver personKey) -> código. */
export function debtorCodes(env: Env): Map<string, string> {
  const codes = new Map<string, string>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(PREFIX) || typeof value !== "string") continue;
    const key = personKey(name.slice(PREFIX.length));
    const code = value.trim();
    if (key && code.length >= MIN_CODE_LENGTH) codes.set(key, code);
  }
  return codes;
}

/**
 * Pessoas com código, em ordem alfabética, com o nome escrito como nos devedores ("José", não "JOSE").
 * Quem ainda não tem nenhum devedor aparece com o nome da variável (DEBTOR_CODE_MARIA_CLARA -> "Maria Clara").
 */
export async function peopleWithAccess(ctx: Ctx, codes: Map<string, string>): Promise<{ key: string; name: string }[]> {
  const known = new Map<string, string>();
  for (const p of await listPeople(ctx)) if (!known.has(personKey(p))) known.set(personKey(p), p);
  return [...codes.keys()]
    .map((key) => ({ key, name: known.get(key) ?? titleCase(key) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function titleCase(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

type Row = DebtorItem & { installment_group: string | null };

/** Tudo o que a pessoa deve (em aberto e parcelas futuras) e o que já pagou. Sem cartão, ids ou dados de outras pessoas. */
export async function debtorStatement(ctx: Ctx, key: string, person: string): Promise<DebtorStatement> {
  // A mesma pessoa pode ter sido escrita de jeitos diferentes ("jose", "José"): junta todas as grafias
  const spellings = (await ctx.db.prepare("SELECT DISTINCT person FROM receivables").all<{ person: string }>()).results
    .map((r) => r.person)
    .filter((p) => personKey(p) === key);
  const rows = spellings.length
    ? (
        await ctx.db
          .prepare(
            `SELECT description, amount_cents, date, month, received_at, installment_group, installment_no, installment_total
             FROM receivables WHERE person IN (${spellings.map(() => "?").join(", ")})
             ORDER BY date DESC, id DESC`,
          )
          .bind(...spellings)
          .all<Row>()
      ).results
    : [];

  const item = ({ installment_group: _, ...r }: Row): DebtorItem => r;
  const pending = rows.filter((r) => !r.received_at);
  const due = pending.filter((r) => isDue(r, ctx.month)).map(item);
  const upcoming = pending
    .filter((r) => !isDue(r, ctx.month))
    .sort((a, b) => a.month.localeCompare(b.month))
    .map(item);
  const paid = rows
    .filter((r) => r.received_at)
    .sort((a, b) => b.received_at!.localeCompare(a.received_at!))
    .map(item);
  const total = (items: DebtorItem[]) => items.reduce((s, r) => s + r.amount_cents, 0);
  return { person, month: ctx.month, due, due_cents: total(due), upcoming, upcoming_cents: total(upcoming), paid };
}
