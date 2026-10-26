-- LifeOS para várias pessoas, fase 2 (docs/multi-user-plan.md): contas próprias, login com passkey,
-- convites, recuperação de acesso e conector do Claude por pessoa. Migração aditiva.

ALTER TABLE users ADD COLUMN timezone TEXT;                              -- NULL = fuso padrão do app (TIMEZONE)
ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0; -- aumentar derruba todas as sessões da pessoa
ALTER TABLE users ADD COLUMN invited_by INTEGER;                         -- quem convidou
ALTER TABLE users ADD COLUMN disabled_at TEXT;                           -- desativada pelo admin: não entra mais
ALTER TABLE users ADD COLUMN last_login_at TEXT;

-- Passkeys (WebAuthn). Só a chave pública fica aqui; a privada nunca sai do aparelho da pessoa.
CREATE TABLE passkeys (
  id           TEXT    PRIMARY KEY,         -- id da credencial (base64url)
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key   TEXT    NOT NULL,            -- chave pública COSE (base64url)
  counter      INTEGER NOT NULL DEFAULT 0,
  transports   TEXT,                        -- JSON
  device       TEXT,                        -- para a pessoa reconhecer (ex.: "iPhone")
  backed_up    INTEGER NOT NULL DEFAULT 0,  -- sincronizada (iCloud, Google...)
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);
CREATE INDEX idx_passkeys_user ON passkeys(user_id);

-- Convites (conta nova) e links de recuperação (nova passkey para quem já tem conta). O token só existe no link.
CREATE TABLE invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash  TEXT    NOT NULL UNIQUE,      -- SHA-256 do token
  kind        TEXT    NOT NULL,             -- invite | recovery
  name        TEXT,                         -- nome sugerido (convite)
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE, -- recuperação: de quem é; convite: quem entrou
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Desafios do WebAuthn: uso único e validade curta (impede reaproveitar uma resposta de login)
CREATE TABLE auth_challenges (
  id         TEXT    PRIMARY KEY,           -- aleatório, vai para o navegador
  challenge  TEXT    NOT NULL,
  purpose    TEXT    NOT NULL,              -- login | register
  user_id    INTEGER,                       -- register: quem ganha a passkey (NULL = conta nova do convite)
  invite_id  INTEGER,
  expires_at TEXT    NOT NULL
);

-- Tokens do conector do Claude (MCP), um ou mais por pessoa. Guardados só como hash.
CREATE TABLE mcp_tokens (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at   TEXT
);
CREATE INDEX idx_mcp_tokens_user ON mcp_tokens(user_id);
