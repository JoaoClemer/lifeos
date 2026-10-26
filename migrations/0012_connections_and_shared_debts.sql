-- LifeOS para várias pessoas, fase 3 (docs/multi-user-plan.md): conexões entre pessoas e dívidas conectadas.
-- Migração aditiva.

-- Pessoas conectadas (uma linha por par, com user_a < user_b). O convite já conecta quem convidou e quem entrou.
CREATE TABLE connections (
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE INDEX idx_connections_b ON connections(user_b);
INSERT OR IGNORE INTO connections (user_a, user_b)
  SELECT MIN(id, invited_by), MAX(id, invited_by) FROM users WHERE invited_by IS NOT NULL AND invited_by <> id;

-- Link para conectar duas pessoas que já têm conta (uso único, 7 dias; só o hash fica aqui)
CREATE TABLE connection_links (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT    NOT NULL UNIQUE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- quem gerou
  expires_at TEXT    NOT NULL,
  used_at    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Um nome dos devedores de uma pessoa ligado à conta de uma pessoa conectada
CREATE TABLE person_links (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- quem tem a receber
  person_key     TEXT    NOT NULL,                                        -- chave do nome (personKey: "José" -> "JOSE")
  linked_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- quem deve
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, person_key)
);
CREATE INDEX idx_person_links_linked ON person_links(linked_user_id);

-- A linha do devedor continua sendo de quem tem a receber; quem deve só lê (e marca "paguei" ou contesta)
ALTER TABLE receivables ADD COLUMN debtor_user_id INTEGER; -- conta de quem deve (nome ligado)
ALTER TABLE receivables ADD COLUMN paid_claimed_at TEXT;   -- quem deve marcou "paguei": aguardando confirmação
ALTER TABLE receivables ADD COLUMN disputed_at TEXT;       -- quem deve contestou
ALTER TABLE receivables ADD COLUMN dispute_note TEXT;
CREATE INDEX idx_receivables_debtor ON receivables(debtor_user_id, month);
