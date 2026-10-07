-- Migração aditiva: não altera nem remove nada existente (o código anterior continua funcionando).

-- Entradas extras de dinheiro no mês (13º, bônus, PLR, freela...). O salário fixo continua em settings.income_cents.
CREATE TABLE incomes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  description  TEXT    NOT NULL,
  amount_cents INTEGER NOT NULL,
  date         TEXT    NOT NULL,
  month        TEXT    NOT NULL,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_incomes_month ON incomes(month);

-- Devedor parcelado: cada parcela é uma linha em receivables, agrupadas por installment_group.
-- Linhas existentes ficam com NULL (devedor à vista).
ALTER TABLE receivables ADD COLUMN installment_group TEXT;
ALTER TABLE receivables ADD COLUMN installment_no INTEGER;
ALTER TABLE receivables ADD COLUMN installment_total INTEGER;
CREATE INDEX idx_receivables_group ON receivables(installment_group);
