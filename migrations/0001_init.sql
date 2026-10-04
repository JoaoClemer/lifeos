-- Valores monetários sempre em centavos (INTEGER).
-- Datas: 'YYYY-MM-DD'. Meses de referência: 'YYYY-MM'.

-- Cartões e outras formas de pagamento (Pix, VR, débito...)
CREATE TABLE accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL DEFAULT 'credit', -- credit | debit | pix | cash | voucher | other
  closing_day INTEGER,                            -- dia de fechamento da fatura (só crédito)
  due_day     INTEGER,                            -- dia de vencimento da fatura (só crédito)
  color       TEXT,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Mensais: assinaturas, contas e "orçamentos" (fixos a descontar, ex.: almoço, transporte)
CREATE TABLE recurring (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  is_budget    INTEGER NOT NULL DEFAULT 0,  -- 1 = orçamento: lançamentos são descontados dele
  day          INTEGER,                     -- dia de vencimento/cobrança (opcional)
  start_month  TEXT    NOT NULL,
  end_month    TEXT,                        -- último mês ativo (inclusive); NULL = sem fim
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Ajustes de um fixo em um mês específico (ex.: conta de luz veio diferente) e marcação de pago
CREATE TABLE recurring_months (
  recurring_id INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  month        TEXT    NOT NULL,
  amount_cents INTEGER,
  paid         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recurring_id, month)
);

-- Parcelados
CREATE TABLE installments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  description        TEXT    NOT NULL,
  installment_cents  INTEGER NOT NULL,
  total_installments INTEGER NOT NULL,
  first_month        TEXT    NOT NULL, -- mês (fatura) da parcela 1
  last_month         TEXT    NOT NULL, -- mês (fatura) da última parcela
  account_id         INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  purchase_date      TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_installments_months ON installments(first_month, last_month);

-- Lançamentos avulsos (gastos do mês). budget_id liga o gasto a um orçamento.
CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,       -- sua parte (se dividido, a parte dos outros vira devedor)
  date         TEXT    NOT NULL,
  month        TEXT    NOT NULL,       -- mês de referência (fatura)
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  budget_id    INTEGER REFERENCES recurring(id) ON DELETE SET NULL,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_expenses_month ON expenses(month);
CREATE INDEX idx_expenses_budget ON expenses(budget_id, month);

-- Devedores: parte de outras pessoas que passou no seu cartão / que te devem
CREATE TABLE receivables (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  person       TEXT    NOT NULL,
  description  TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  date         TEXT    NOT NULL,
  month        TEXT    NOT NULL,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL, -- se preenchido, entra na fatura desse cartão
  expense_id   INTEGER REFERENCES expenses(id) ON DELETE SET NULL, -- gasto dividido que originou
  received_at  TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receivables_pending ON receivables(received_at, person);
CREATE INDEX idx_receivables_month ON receivables(month);

-- Investimentos e metas (cada item é uma "caixinha" com saldo; alvo e aporte mensal são opcionais)
CREATE TABLE goals (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  institution   TEXT,              -- onde está investido (ex.: Tesouro Selic, CDB Nubank)
  target_cents  INTEGER,           -- valor da meta
  monthly_cents INTEGER,           -- aporte mensal planejado
  deadline      TEXT,              -- 'YYYY-MM'
  start_month   TEXT    NOT NULL,
  color         TEXT,
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Movimentações das metas. amount_cents é sempre o efeito no saldo (positivo ou negativo).
CREATE TABLE goal_entries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  goal_id      INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL, -- contribution (aporte) | withdrawal (resgate) | adjustment (rendimento/ajuste de saldo)
  amount_cents INTEGER NOT NULL,
  month        TEXT    NOT NULL,
  date         TEXT    NOT NULL,
  note         TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_goal_entries ON goal_entries(goal_id, month);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
