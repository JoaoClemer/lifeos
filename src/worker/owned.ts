/**
 * Tabelas em que cada linha é de uma pessoa (coluna user_id). Toda consulta a elas filtra pelo dono
 * (test/ownerGuard.ts confere), o backup exporta e a exclusão da conta apaga exatamente estas.
 */
export const OWNED_TABLES = [
  "accounts",
  "recurring",
  "recurring_months",
  "installments",
  "expenses",
  "receivables",
  "incomes",
  "goals",
  "goal_entries",
  "projects",
  "tasks",
  "events",
  "activity_log",
  "training_sessions",
  "user_settings",
  "user_month_balances",
  "person_links",
  "event_participants",
  "project_members",
] as const;

export type OwnedTable = (typeof OWNED_TABLES)[number];
