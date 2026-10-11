import type { Ctx } from "./lib";

/**
 * Registro no histórico (activity_log). Devolve o statement para entrar no mesmo batch da alteração:
 * a ação e o registro dela são gravados juntos ou nenhum dos dois.
 */
export function activity(ctx: Ctx, action: string, entity: string, entityId: number, detail?: Record<string, unknown>): D1PreparedStatement {
  return ctx.db
    .prepare("INSERT INTO activity_log (source, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(ctx.source, action, entity, entityId, detail ? JSON.stringify(detail) : null);
}
