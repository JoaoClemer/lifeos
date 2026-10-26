-- LifeOS para várias pessoas, fase 6 (docs/multi-user-plan.md): metas em conjunto.
-- A meta continua sendo de quem criou; membros (pessoas conectadas) veem e fazem aportes. O saldo é a soma de todos;
-- cada movimentação registra quem fez (goal_entries.user_id) e no resumo de cada pessoa entram só os aportes dela.
CREATE TABLE goal_members (
  goal_id       INTEGER NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- membro (o dono é goals.user_id)
  monthly_cents INTEGER,                                                 -- aporte mensal planejado desta pessoa
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (goal_id, user_id)
);
CREATE INDEX idx_goal_members_user ON goal_members(user_id);
