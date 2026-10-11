-- Migração aditiva (LifeOS): histórico de ações (conclusões, reaberturas, mudanças de status) e auditoria do MCP.

CREATE TABLE activity_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT    NOT NULL DEFAULT (datetime('now')),
  source    TEXT    NOT NULL,   -- app | mcp
  action    TEXT    NOT NULL,   -- ex.: task.completed, task.reopened, mcp.call
  entity    TEXT,               -- task | event | training | ...
  entity_id INTEGER,
  detail    TEXT                -- JSON curto. Nunca tokens ou segredos
);
CREATE INDEX idx_activity_entity ON activity_log(entity, entity_id);
