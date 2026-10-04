-- Dados FICTÍCIOS para desenvolvimento local, relativos ao mês atual.
-- Rode em um banco vazio:  npm run db:seed:local
-- Para importar seus dados reais, crie um seed/<nome>.local.sql (ignorado pelo git).

INSERT INTO accounts (id, name, type, closing_day, due_day) VALUES
  (1, 'Cartão Exemplo', 'credit', 5, 12),
  (2, 'Pix', 'pix', NULL, NULL),
  (3, 'VR', 'voucher', NULL, NULL);

INSERT INTO settings (key, value) VALUES ('default_account_id', '1'), ('income_cents', '650000');

INSERT INTO installments (description, installment_cents, total_installments, first_month, last_month, account_id) VALUES
  ('Notebook',         45000, 12, strftime('%Y-%m', 'now', 'start of month', '-3 months'), strftime('%Y-%m', 'now', 'start of month', '+8 months'), 1),
  ('Fone de ouvido',   12000,  3, strftime('%Y-%m', 'now', 'start of month', '-1 months'), strftime('%Y-%m', 'now', 'start of month', '+1 months'), 1),
  ('Passagem aérea',   38990,  2, strftime('%Y-%m', 'now', 'start of month', '-1 months'), strftime('%Y-%m', 'now', 'start of month'), 1);

INSERT INTO recurring (id, description, amount_cents, account_id, is_budget, day, start_month) VALUES
  (1, 'Streaming',      3990, 1,    0, 10,   strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (2, 'Internet',       9990, 1,    0, 15,   strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (3, 'Academia',       8990, 1,    0, 5,    strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (4, 'Conta de luz',  16000, 1,    0, 20,   strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (5, 'Almoço',        60000, NULL, 1, NULL, strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (6, 'Transporte',    15000, NULL, 1, NULL, strftime('%Y-%m', 'now', 'start of month', '-6 months'));

INSERT INTO expenses (description, amount_cents, date, month, account_id, budget_id) VALUES
  ('Mercado',     23045, date('now', 'start of month'),            strftime('%Y-%m', 'now'), 1, NULL),
  ('Farmácia',     4230, date('now', 'start of month', '+1 day'),  strftime('%Y-%m', 'now'), 1, NULL),
  ('Gasolina',    15000, date('now', 'start of month', '+2 days'), strftime('%Y-%m', 'now'), 1, NULL),
  ('Almoço',       3250, date('now', 'start of month'),            strftime('%Y-%m', 'now'), 3, 5),
  ('Almoço',       2890, date('now', 'start of month', '+1 day'),  strftime('%Y-%m', 'now'), 3, 5),
  ('Metrô',         540, date('now', 'start of month'),            strftime('%Y-%m', 'now'), 2, 6),
  ('Metrô',         540, date('now', 'start of month', '+1 day'),  strftime('%Y-%m', 'now'), 2, 6);

INSERT INTO receivables (person, description, amount_cents, date, month, account_id) VALUES
  ('Ana',   'Jantar',   6000, date('now', 'start of month'),           strftime('%Y-%m', 'now'), 1),
  ('Pedro', 'Ingresso', 12000, date('now', 'start of month', '+1 day'), strftime('%Y-%m', 'now'), 1);

INSERT INTO goals (id, name, institution, target_cents, monthly_cents, deadline, start_month) VALUES
  (1, 'Reserva de emergência', 'Tesouro Selic', 2000000, 80000, NULL, strftime('%Y-%m', 'now', 'start of month', '-6 months')),
  (2, 'Viagem',                'CDB liquidez',   600000, 50000, strftime('%Y-%m', 'now', 'start of month', '+10 months'), strftime('%Y-%m', 'now', 'start of month', '-2 months'));

INSERT INTO goal_entries (goal_id, kind, amount_cents, month, date, note) VALUES
  (1, 'adjustment', 500000, strftime('%Y-%m', 'now', 'start of month', '-6 months'), date('now', 'start of month', '-6 months'), 'Saldo inicial'),
  (2, 'adjustment', 120000, strftime('%Y-%m', 'now', 'start of month', '-2 months'), date('now', 'start of month', '-2 months'), 'Saldo inicial');
