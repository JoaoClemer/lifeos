-- LifeOS para várias pessoas, fase 5 (docs/multi-user-plan.md): listas de tarefas compartilhadas e tarefas designadas.
-- Projeto compartilhado: os membros veem e editam as tarefas dele (só o dono altera o projeto e os membros).
-- Tarefa designada: a pessoa designada vê e edita a tarefa, mesmo fora de uma lista compartilhada.
CREATE TABLE project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- membro (o dono é projects.user_id)
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members(user_id);

ALTER TABLE tasks ADD COLUMN assignee_user_id INTEGER; -- pessoa conectada designada para a tarefa
CREATE INDEX idx_tasks_assignee ON tasks(assignee_user_id, status);
