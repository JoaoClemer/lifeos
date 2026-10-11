-- Migração aditiva (LifeOS): tarefas e projetos. Não altera nenhuma tabela existente.

CREATE TABLE projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  description TEXT,
  status      TEXT    NOT NULL DEFAULT 'active', -- active | paused | done | archived
  due_date    TEXT,                               -- 'YYYY-MM-DD'
  color       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tasks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  notes            TEXT,
  status           TEXT    NOT NULL DEFAULT 'todo',   -- todo | doing | done
  priority         TEXT    NOT NULL DEFAULT 'medium', -- low | medium | high
  due_date         TEXT,              -- prazo 'YYYY-MM-DD'. Não ocupa horário: para reservar um horário, crie um evento com task_id
  estimate_minutes INTEGER,
  tags             TEXT,              -- JSON array de etiquetas, ex.: ["casa","banco"]
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  parent_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE, -- subtarefa (um nível só)
  completed_at     TEXT,              -- data e hora local da conclusão ('YYYY-MM-DDTHH:MM'); NULL se não concluída
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_open    ON tasks(status, due_date);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
