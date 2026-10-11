-- Migração aditiva: dia em que você paga a fatura do cartão.
-- Ex.: vence dia 1 e você paga dia 25 (quando recebe o salário) → a fatura conta no mês em que é paga (o anterior ao vencimento).
-- NULL = paga no mês do vencimento (comportamento anterior).
ALTER TABLE accounts ADD COLUMN payment_day INTEGER;
