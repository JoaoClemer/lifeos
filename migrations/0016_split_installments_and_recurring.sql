-- Dividir parcelados e fixos com outras pessoas (como já dava nos avulsos). Migração aditiva.
-- Nas suas listas fica só a sua parte; a parte de cada pessoa vira devedor (receivables), ligado ao lançamento de origem.

ALTER TABLE receivables ADD COLUMN installment_id INTEGER; -- parte de outra pessoa num parcelado seu (uma linha por parcela)
ALTER TABLE receivables ADD COLUMN recurring_id INTEGER;   -- parte de outra pessoa num fixo seu (uma linha por mês)
CREATE INDEX idx_receivables_installment ON receivables(installment_id) WHERE installment_id IS NOT NULL;
-- Um devedor por pessoa e mês para cada fixo dividido (a geração mensal não duplica)
CREATE UNIQUE INDEX idx_receivables_recurring ON receivables(recurring_id, person, month) WHERE recurring_id IS NOT NULL;

-- Com quem cada fixo é dividido. Todo mês a parte da pessoa vira um devedor, gerado até `generated_through`.
CREATE TABLE recurring_splits (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL,                                            -- dono do fixo (quem tem a receber)
  recurring_id      INTEGER NOT NULL REFERENCES recurring(id) ON DELETE CASCADE,
  person            TEXT    NOT NULL,
  amount_cents      INTEGER NOT NULL,                                            -- parte da pessoa por mês
  generated_through TEXT    NOT NULL,                                            -- último mês já gerado ('YYYY-MM')
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (recurring_id, person)
);
CREATE INDEX idx_recurring_splits_user ON recurring_splits(user_id);
