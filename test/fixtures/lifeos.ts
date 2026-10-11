// Limpa as tabelas dos módulos do LifeOS entre os testes (os dados de cada teste são criados pelos próprios services).
export async function resetLifeOS(db: D1Database): Promise<void> {
  await db.batch(["events", "tasks", "projects", "activity_log"].map((t) => db.prepare(`DELETE FROM ${t}`)));
}
