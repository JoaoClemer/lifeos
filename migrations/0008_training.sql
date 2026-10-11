-- Migração aditiva (LifeOS): treinos planejados e realizados. Não altera nenhuma tabela existente.
-- Planejado e realizado ficam na mesma linha, em colunas separadas: registrar o resultado atualiza a linha
-- (não cria outra) e o plano original continua guardado para comparar. Duração em segundos, distância em metros.
-- O ritmo não é gravado: é calculado a partir da duração e da distância.

CREATE TABLE training_sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport              TEXT    NOT NULL,      -- run | bike | swim | strength | other
  title              TEXT,                  -- ex.: "Longão", "Intervalado 6x800", "Treino A"
  workout_type       TEXT,                  -- easy | long | intervals | tempo | recovery | race | strength | technique | other
  date               TEXT    NOT NULL,      -- dia do treino ('YYYY-MM-DD')
  time               TEXT,                  -- horário planejado ('HH:MM'), opcional: com ele o treino aparece com hora na agenda
  unplanned          INTEGER NOT NULL DEFAULT 0, -- 1 = registrado sem ter sido planejado (fora do % de cumprimento)
  planned_duration_s INTEGER,
  planned_distance_m INTEGER,
  planned_intensity  TEXT,                  -- ex.: "Z2", "RPE 6", "5:30/km"
  instructions       TEXT,                  -- estrutura do treino; musculação: exercícios e séries em texto livre
  status             TEXT    NOT NULL DEFAULT 'planned', -- planned | done | partial | skipped | cancelled
  actual_start       TEXT,                  -- 'YYYY-MM-DDTHH:MM' local
  actual_duration_s  INTEGER,
  actual_distance_m  INTEGER,
  avg_hr             INTEGER,
  max_hr             INTEGER,
  rpe                INTEGER,               -- percepção de esforço, 1 a 10
  notes              TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_training_date ON training_sessions(date);
