-- Migração aditiva (LifeOS): tarefas que se repetem. Só acrescenta colunas (NULL nas tarefas existentes).
-- Ao concluir uma tarefa com rrule, a próxima é criada com o novo prazo e recurrence_of apontando para a concluída:
-- cada conclusão fica no histórico como uma tarefa concluída.
ALTER TABLE tasks ADD COLUMN rrule TEXT;
ALTER TABLE tasks ADD COLUMN recurrence_of INTEGER REFERENCES tasks(id) ON DELETE SET NULL;
CREATE INDEX idx_tasks_recurrence_of ON tasks(recurrence_of);
