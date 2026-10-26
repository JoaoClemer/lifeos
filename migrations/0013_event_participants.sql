-- LifeOS para várias pessoas, fase 4 (docs/multi-user-plan.md): convidar pessoas conectadas para eventos.
-- O evento continua sendo de quem criou; o convidado vê na agenda dele (em séries, o convite vale para a série) e aceita ou recusa.
CREATE TABLE event_participants (
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, -- evento único ou série (linha principal)
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- convidado
  status       TEXT    NOT NULL DEFAULT 'invited',                       -- invited | accepted | declined
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  responded_at TEXT,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX idx_event_participants_user ON event_participants(user_id, status);
