// Dados FICTÍCIOS com datas fixas para os testes do financeiro. "Hoje" nos testes = 15/10/2026.
// Os valores esperados nos testes foram calculados à mão a partir destes dados; se mudar algo aqui, revise-os.
import type { Ctx } from "../../src/worker/lib";

export const TODAY = "2026-10-15";
export const MONTH = "2026-10";

/** Ctx de teste. Os dados de exemplo são da pessoa 1 (o dono). */
export function testCtx(db: D1Database, today = TODAY, time = "10:00", userId = 1): Ctx {
  return { db, userId, today, month: today.slice(0, 7), timezone: "America/Sao_Paulo", now: `${today}T${time}`, source: "app" };
}

/** Tabelas do financeiro, das dependentes para as independentes (ordem segura para apagar). */
const TABLES = [
  "goal_entries",
  "goals",
  "receivables",
  "expenses",
  "incomes",
  "recurring_months",
  "recurring",
  "installments",
  "user_month_balances",
  "user_settings",
  "accounts",
];

const SEED = [
  // Cartão A: fecha 24, vence 1, paga 25 (a fatura conta no mês anterior ao vencimento)
  // Cartão B: fecha 5, vence 12
  `INSERT INTO accounts (id, name, type, closing_day, due_day, payment_day) VALUES
     (1, 'Cartão A', 'credit', 24, 1, 25),
     (2, 'Cartão B', 'credit', 5, 12, NULL),
     (3, 'Pix', 'pix', NULL, NULL, NULL),
     (4, 'VR', 'voucher', NULL, NULL, NULL)`,
  `INSERT INTO user_settings (user_id, key, value) VALUES
     (1, 'default_account_id', '2'), (1, 'income_cents', '650000'), (1, 'balance_start_month', '2026-09')`,
  `INSERT INTO installments (id, description, installment_cents, total_installments, first_month, last_month, account_id, purchase_date) VALUES
     (1, 'Notebook', 45000, 12, '2026-07', '2027-06', 2, '2026-06-20'),
     (2, 'Fone', 12000, 3, '2026-09', '2026-11', 1, '2026-08-10'),
     (3, 'Passagem', 38990, 2, '2026-09', '2026-10', 2, '2026-08-01')`,
  `INSERT INTO recurring (id, description, amount_cents, account_id, is_budget, day, start_month, end_month) VALUES
     (1, 'Streaming', 3990, 1, 0, 10, '2026-01', NULL),
     (2, 'Internet', 9990, 2, 0, 15, '2026-01', NULL),
     (3, 'Academia', 8990, 2, 0, 5, '2026-01', '2026-10'),
     (4, 'Conta de luz', 16000, 3, 0, 20, '2026-01', NULL),
     (5, 'Almoço', 60000, NULL, 1, NULL, '2026-01', NULL),
     (6, 'Transporte', 15000, NULL, 1, NULL, '2026-01', NULL)`,
  `INSERT INTO recurring_months (recurring_id, month, amount_cents, paid) VALUES
     (4, '2026-10', 21237, 1),
     (6, '2026-11', 20000, 0),
     (2, '2026-10', NULL, 1)`,
  `INSERT INTO expenses (id, description, amount_cents, date, month, account_id, budget_id, notes) VALUES
     (1, 'Mercado', 23045, '2026-10-02', '2026-10', 2, NULL, NULL),
     (2, 'Farmácia', 4230, '2026-10-06', '2026-11', 2, NULL, NULL),
     (3, 'Gasolina', 15000, '2026-10-03', '2026-10', 1, NULL, NULL),
     (4, 'Almoço', 3250, '2026-10-01', '2026-10', 4, 5, NULL),
     (5, 'Almoço', 2890, '2026-10-02', '2026-10', 4, 5, NULL),
     (6, 'Uber', 1890, '2026-10-05', '2026-10', 3, 6, NULL),
     (7, 'Uber aeroporto', 16000, '2026-10-08', '2026-10', 3, 6, NULL),
     (8, 'Jantar', 9300, '2026-10-10', '2026-10', 1, NULL, 'dividido'),
     (9, 'Mercado do mês', 30000, '2026-09-15', '2026-09', 3, NULL, NULL)`,
  `INSERT INTO receivables (id, person, description, amount_cents, date, month, account_id, expense_id, received_at, installment_group, installment_no, installment_total) VALUES
     (1, 'Ana', 'Jantar', 9300, '2026-10-10', '2026-10', 1, 8, NULL, NULL, NULL, NULL),
     (2, 'Pedro', 'Celular', 20000, '2026-10-01', '2026-10', 2, NULL, NULL, 'g1', 1, 3),
     (3, 'Pedro', 'Celular', 20000, '2026-10-01', '2026-11', 2, NULL, NULL, 'g1', 2, 3),
     (4, 'Pedro', 'Celular', 20000, '2026-10-01', '2026-12', 2, NULL, NULL, 'g1', 3, 3),
     (5, 'Bruno', 'Show', 15000, '2026-09-20', '2026-09', NULL, NULL, '2026-09-30', NULL, NULL, NULL)`,
  `INSERT INTO incomes (id, description, amount_cents, date, month, notes) VALUES
     (1, 'Freela', 80000, '2026-10-20', '2026-10', NULL)`,
  `INSERT INTO goals (id, name, institution, target_cents, monthly_cents, deadline, start_month, color, archived) VALUES
     (1, 'Reserva', 'Tesouro Selic', 2000000, 50000, NULL, '2026-01', NULL, 0),
     (2, 'Viagem', NULL, 600000, 100000, '2027-03', '2026-09', NULL, 0)`,
  `INSERT INTO goal_entries (id, goal_id, kind, amount_cents, month, date, note) VALUES
     (1, 1, 'adjustment', 500000, '2026-01', '2026-01-05', 'Saldo inicial'),
     (2, 1, 'contribution', 50000, '2026-09', '2026-09-25', NULL),
     (3, 1, 'contribution', 50000, '2026-10', '2026-10-05', NULL),
     (4, 2, 'contribution', 100000, '2026-09', '2026-09-25', NULL)`,
  `INSERT INTO user_month_balances (user_id, month, opening_cents, note) VALUES (1, '2026-11', 100000, 'Conferido no banco')`,
];

/** Apaga tudo do financeiro e carrega a fixture. */
export async function resetFinance(db: D1Database): Promise<void> {
  await db.batch([
    ...TABLES.map((t) => db.prepare(`DELETE FROM ${t}`)),
    // Só o dono (pessoa 1) fica; outras pessoas são criadas nos testes de isolamento
    db.prepare("DELETE FROM users WHERE id <> 1"),
    ...SEED.map((s) => db.prepare(s)),
  ]);
}
