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

-- Entrada extra no mês (além do salário fixo em settings.income_cents)
INSERT INTO incomes (description, amount_cents, date, month) VALUES
  ('Bônus', 150000, date('now', 'start of month', '+4 days'), strftime('%Y-%m', 'now'));

-- Devedor parcelado: 4x de R$ 250 passado no cartão para outra pessoa (parcela 2 cai neste mês)
INSERT INTO receivables (person, description, amount_cents, date, month, account_id, installment_group, installment_no, installment_total) VALUES
  ('Pedro', 'Celular', 25000, date('now', 'start of month', '-1 months'), strftime('%Y-%m', 'now', 'start of month', '-1 months'), 1, 'example-celular', 1, 4),
  ('Pedro', 'Celular', 25000, date('now', 'start of month', '-1 months'), strftime('%Y-%m', 'now'),                               1, 'example-celular', 2, 4),
  ('Pedro', 'Celular', 25000, date('now', 'start of month', '-1 months'), strftime('%Y-%m', 'now', 'start of month', '+1 months'), 1, 'example-celular', 3, 4),
  ('Pedro', 'Celular', 25000, date('now', 'start of month', '-1 months'), strftime('%Y-%m', 'now', 'start of month', '+2 months'), 1, 'example-celular', 4, 4);

-- LifeOS: projetos, tarefas e agenda (fictícios, relativos a hoje no fuso de São Paulo)
INSERT INTO projects (id, name, status) VALUES (1, 'Mudança de apartamento', 'active');

INSERT INTO tasks (title, priority, due_date, project_id, tags, estimate_minutes) VALUES
  ('Renovar a CNH',          'high',   date('now', '-3 hours', '-2 days'), NULL, '["documentos"]', 60),
  ('Pagar o condomínio',     'medium', date('now', '-3 hours'),            NULL, '["casa"]',       15),
  ('Orçar a mudança',        'high',   date('now', '-3 hours', '+3 days'), 1,    NULL,             NULL),
  ('Separar doações',        'low',    NULL,                               1,    NULL,             120),
  ('Ler o livro do clube',   'medium', NULL,                               NULL, NULL,             NULL);

INSERT INTO events (title, start_at, end_at, all_day, location, url, category, color, rrule) VALUES
  ('Dentista', strftime('%Y-%m-%dT14:00', 'now', '-3 hours'), strftime('%Y-%m-%dT15:00', 'now', '-3 hours'), 0, 'Clínica Centro', NULL, 'Saúde', 'rose', NULL),
  ('Inglês', strftime('%Y-%m-%dT19:00', 'now', '-3 hours', 'weekday 1', '-7 days'), strftime('%Y-%m-%dT20:30', 'now', '-3 hours', 'weekday 1', '-7 days'), 0, NULL, NULL, 'Estudos', 'violet', 'FREQ=WEEKLY;BYDAY=MO,WE'),
  ('Reunião de planejamento', strftime('%Y-%m-%dT10:00', 'now', '-3 hours', '+1 day'), strftime('%Y-%m-%dT11:00', 'now', '-3 hours', '+1 day'), 0, NULL, 'https://meet.example.com/planejamento', 'Trabalho', 'blue', NULL),
  ('Aniversário da Ana', date('now', '-3 hours', '+5 days') || 'T00:00', date('now', '-3 hours', '+6 days') || 'T00:00', 1, NULL, NULL, 'Família', 'amber', NULL);

-- LifeOS: treinos (fictícios). Semana atual: alguns já registrados, outros planejados.
INSERT INTO training_sessions (sport, title, workout_type, date, time, planned_duration_s, planned_distance_m, planned_intensity, instructions, status, actual_duration_s, actual_distance_m, avg_hr, rpe) VALUES
  ('run',      NULL,        'easy',      date('now', '-3 hours', '-2 days'), '06:30', 3000, 8000,  'Z2',     NULL,                                  'done',    3080, 8200, 146, 5),
  ('strength', 'Treino A',  'strength',  date('now', '-3 hours', '-1 day'),  NULL,    3600, NULL,  NULL,     'Agachamento 4x10, Supino 4x8, Remada 4x10', 'skipped', NULL, NULL, NULL, NULL),
  ('run',      'Intervalado', 'intervals', date('now', '-3 hours'),          '18:30', 3300, 9000,  'forte',  '15 min aquecimento, 6x800 m, 10 min solto', 'planned', NULL, NULL, NULL, NULL),
  ('swim',     NULL,        'technique', date('now', '-3 hours', '+1 day'),  '07:00', 2700, 2000,  NULL,     NULL,                                  'planned', NULL, NULL, NULL, NULL),
  ('run',      'Longão',    'long',      date('now', '-3 hours', '+3 days'), '07:00', 6600, 18000, 'Z2',     NULL,                                  'planned', NULL, NULL, NULL, NULL);

-- Gastos de hoje (aparecem na tela Hoje)
INSERT INTO expenses (description, amount_cents, date, month, account_id, budget_id) VALUES
  ('Café da manhã', 1290, date('now', '-3 hours'), strftime('%Y-%m', 'now', '-3 hours'), 2, NULL),
  ('Almoço',        3450, date('now', '-3 hours'), strftime('%Y-%m', 'now', '-3 hours'), 3, 5);
