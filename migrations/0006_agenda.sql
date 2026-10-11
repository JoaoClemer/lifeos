-- Migração aditiva (LifeOS): agenda. Não altera nenhuma tabela existente.
-- Horários ficam no relógio local do fuso do evento ('YYYY-MM-DDTHH:MM'): "toda segunda às 09:00" continua
-- às 09:00 quando o horário de verão muda. Dia inteiro: início T00:00 e fim T00:00 do dia seguinte ao último.

CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  description    TEXT,
  location       TEXT,
  url            TEXT,                -- link da reunião
  category       TEXT,
  color          TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0,
  start_at       TEXT    NOT NULL,
  end_at         TEXT    NOT NULL,    -- exclusivo
  timezone       TEXT    NOT NULL DEFAULT 'America/Sao_Paulo',
  rrule          TEXT,                -- recorrência (subconjunto da RFC 5545), só na linha principal da série
  -- Ocorrência alterada ou cancelada de uma série: aponta para a série e guarda o início original da ocorrência.
  -- As demais ocorrências não são gravadas: são calculadas a partir da regra.
  series_id      INTEGER REFERENCES events(id) ON DELETE CASCADE,
  original_start TEXT,
  cancelled      INTEGER NOT NULL DEFAULT 0,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE SET NULL, -- horário reservado para uma tarefa
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_range ON events(start_at, end_at);
-- Uma única linha por ocorrência alterada: editar a mesma ocorrência duas vezes não duplica
CREATE UNIQUE INDEX idx_events_occurrence ON events(series_id, original_start) WHERE series_id IS NOT NULL;
CREATE INDEX idx_events_task ON events(task_id);
