// Trava de isolamento entre pessoas, ligada em todos os testes (via setup.ts).
// Toda consulta feita pelo código do Worker que cita uma tabela com dono precisa mencionar user_id
// ao menos uma vez por tabela citada (subconsultas inclusive). SQL escrito nos próprios testes fica de fora.

import { OWNED_TABLES } from "../src/worker/owned";

export { OWNED_TABLES };

const OWNED = new Set<string>(OWNED_TABLES);

/** A consulta cita mais tabelas com dono do que menções a user_id? */
export function missingOwner(sql: string): boolean {
  const refs = [...sql.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)/gi)].filter((m) => OWNED.has(m[1].toLowerCase())).length;
  const scoped = (sql.match(/\buser_id\b/g) ?? []).length;
  return refs > scoped;
}

const violations: string[] = [];

/** Envolve db.prepare para registrar consultas do Worker sem dono. */
export function installOwnerGuard(db: D1Database): void {
  const target = db as D1Database & { __ownerGuard?: boolean };
  if (target.__ownerGuard) return;
  target.__ownerGuard = true;
  const prepare = db.prepare.bind(db);
  target.prepare = (sql: string) => {
    // [0] "Error", [1] este wrapper, [2] quem chamou prepare
    const caller = new Error().stack?.split("\n")[2] ?? "";
    if (caller.includes("/src/worker/") && missingOwner(sql)) violations.push(`${sql.replace(/\s+/g, " ").trim()}\n    ${caller.trim()}`);
    return prepare(sql);
  };
}

/** Falha o teste que executou consultas sem dono. */
export function assertNoOwnerViolations(): void {
  if (!violations.length) return;
  const found = violations.splice(0);
  throw new Error(`Consultas sem filtro de dono (user_id):\n${found.join("\n")}`);
}
