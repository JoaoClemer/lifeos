-- Migração aditiva: saldo acumulado entre meses (a sobra de um mês vira o saldo inicial do seguinte).

-- Saldo inicial ajustado manualmente (ex.: conferiu o banco). Sem linha = saldo vem do mês anterior.
CREATE TABLE month_balances (
  month         TEXT    PRIMARY KEY, -- 'YYYY-MM'
  opening_cents INTEGER NOT NULL,    -- pode ser negativo
  note          TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Mês em que o saldo começa a ser acumulado (com saldo 0, se não for ajustado).
-- Usa o mês em que a migração roda (fuso de São Paulo) para não somar "sobras" de meses antigos com dados incompletos.
INSERT OR IGNORE INTO settings (key, value) VALUES ('balance_start_month', strftime('%Y-%m', 'now', '-3 hours'));
