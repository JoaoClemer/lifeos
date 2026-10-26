-- LifeOS para várias pessoas, fase 1 (docs/multi-user-plan.md): cada linha passa a ter dono.
-- Migração aditiva: os dados existentes ficam com a pessoa 1 (o dono atual) e o código anterior continua funcionando.

CREATE TABLE users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,                              -- preenchido no primeiro acesso (fase 2)
  role       TEXT    NOT NULL DEFAULT 'member', -- admin | member
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO users (id, role) VALUES (1, 'admin');

-- Dono de cada linha. Sem REFERENCES: o SQLite não aceita adicionar uma coluna com chave estrangeira e padrão
-- não nulo com as chaves estrangeiras ligadas (o D1 liga). O código só grava user_id de quem está autenticado.
ALTER TABLE accounts ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recurring ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE recurring_months ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE installments ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE expenses ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE receivables ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE incomes ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goals ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE goal_entries ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tasks ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE events ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE activity_log ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE training_sessions ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1;

-- Toda consulta filtra por dono: índices começando por user_id
CREATE INDEX idx_accounts_user ON accounts(user_id);
CREATE INDEX idx_recurring_user ON recurring(user_id, start_month);
CREATE INDEX idx_installments_user ON installments(user_id, first_month, last_month);
CREATE INDEX idx_expenses_user_month ON expenses(user_id, month);
CREATE INDEX idx_receivables_user ON receivables(user_id, received_at, month);
CREATE INDEX idx_incomes_user_month ON incomes(user_id, month);
CREATE INDEX idx_goals_user ON goals(user_id);
CREATE INDEX idx_goal_entries_user ON goal_entries(user_id, goal_id, month);
CREATE INDEX idx_projects_user ON projects(user_id);
CREATE INDEX idx_tasks_user ON tasks(user_id, status, due_date);
CREATE INDEX idx_events_user ON events(user_id, start_at, end_at);
CREATE INDEX idx_activity_user ON activity_log(user_id, at);
CREATE INDEX idx_training_user ON training_sessions(user_id, date);

-- Configurações e saldos ajustados passam a ser por pessoa (as tabelas antigas têm chave só por `key` e `month`).
-- As antigas ficam como estão: num rollback, a versão anterior do código continua lendo delas.
CREATE TABLE user_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key     TEXT    NOT NULL,
  value   TEXT,
  PRIMARY KEY (user_id, key)
);
INSERT INTO user_settings (user_id, key, value) SELECT 1, key, value FROM settings;

CREATE TABLE user_month_balances (
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month         TEXT    NOT NULL, -- 'YYYY-MM'
  opening_cents INTEGER NOT NULL, -- pode ser negativo
  note          TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, month)
);
INSERT INTO user_month_balances (user_id, month, opening_cents, note, updated_at)
  SELECT 1, month, opening_cents, note, updated_at FROM month_balances;
