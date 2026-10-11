# LifeOS: auditoria (Fase 0) e plano técnico

Data da auditoria: 11/10/2026. Base: branch `main` no commit `4355149`.
Status: **plano aprovado em 11/10/2026** (decisões na seção 9). Nenhum código foi alterado nesta fase.

Tudo o que está descrito como "atual" foi verificado lendo o código. O que é proposta está marcado como tal.

---

## 1. Arquitetura atual

### Visão geral

Um único Cloudflare Worker (`name: "financas"` em `wrangler.jsonc`) serve três coisas:

| Caminho | O que é | Onde |
|---|---|---|
| `/*` | SPA React (assets estáticos, fallback para `index.html`) | `wrangler.jsonc` → `assets` |
| `/api/*` | API REST (Hono) com sessão por cookie | `src/worker/index.ts`, `src/worker/api.ts` |
| `/mcp`, `/mcp/:token` | Servidor MCP (JSON-RPC escrito à mão, sem SDK) | `src/worker/mcp/server.ts`, `src/worker/mcp/tools.ts` |

O banco é um único D1 (`binding: DB`). A variável `TIMEZONE = "America/Sao_Paulo"` fica em `vars`. Os segredos são `APP_PASSWORD` e `MCP_TOKEN`.

### Camadas do Worker

- **`index.ts`**: login, middleware de sessão para `/api/*`, montagem da API e do MCP, e o `onError` central (`UserError` vira 4xx, `ZodError` vira 400, o resto vira 500 sem vazar detalhes).
- **`api.ts`**: cerca de 50 rotas finas. Todas só fazem parse de parâmetros e chamam `services/*`.
- **`services/*.ts`**: regras de negócio e SQL direto no D1 (prepared statements). Cada função valida a entrada com Zod (`XInput.parse`) e recebe um `Ctx { db, today, month }` injetado. Isso já deixa os serviços **testáveis** com um banco de teste e uma data fixa.
- **`mcp/server.ts`**: protocolo (initialize, tools/list, tools/call), transporte Streamable HTTP sem sessão e respostas JSON. Foi escrito sem SDK por causa do limite de 10 ms de CPU do plano gratuito.
- **`mcp/tools.ts`** (791 linhas): 19 ferramentas, todas chamando os **mesmos services** da API. Argumentos e saída em pt-BR, com `annotations` (`readOnlyHint`, `destructiveHint`).
- **`lib.ts`**: `UserError`, `makeCtx`, `updateRow` (UPDATE só de colunas permitidas), `mustGet` e `findByName`. O `findByName` resolve nomes com tolerância e devolve erro quando o nome é ambíguo, o que já atende "não executar ações com parâmetros ambíguos".

### Código compartilhado (`src/shared/`)

- `types.ts`: formatos de resposta da API, usados pelo Worker e pelo front.
- `month.ts`: meses `'YYYY-MM'` e datas `'YYYY-MM-DD'` como strings, `todayIn(tz)` e `referenceMonth` (regra de fatura).
- `money.ts`: centavos, `parseMoney` e `formatBRL`.
- `receivables.ts`: `isDue`.

### Front-end (React 19 + Tailwind 4)

- **`App.tsx`**: shell com sidebar no desktop, barra inferior no mobile (`grid-cols-5`, com 4 destinos e o botão "+" no centro), `NAV` com 5 telas e `MonthSwitcher` no cabeçalho.
- **`state.tsx`**:
  - roteador por hash (`#/view/sub?params`);
  - `month` global;
  - `useData(path)`, um cache stale-while-revalidate por URL que recarrega via `version`;
  - `useMutation`, que executa a ação, mostra um toast e chama `refresh`;
  - `SheetState`, uma união discriminada de todos os modais.
- **`SheetHost.tsx`**: renderiza o modal correspondente a cada `SheetState`.
- **`ui.tsx`**: componentes reutilizáveis (Card, Section, Button, Sheet, Field, TextInput, MoneyInput, Chips, Segmented, Toggle, Progress, CheckCircle, Badge, Row, List, Empty).
- **`styles.css`**: tokens de cor em CSS variables, com tema escuro automático.

### Banco D1

São 11 tabelas criadas em 4 migrations, todas aditivas. Convenções seguidas em todas elas:

- `INTEGER PRIMARY KEY AUTOINCREMENT` e nomes em snake_case;
- dinheiro em **centavos** INTEGER;
- datas e meses como TEXT (`'YYYY-MM-DD'`, `'YYYY-MM'`);
- booleanos como INTEGER 0/1;
- `created_at DEFAULT (datetime('now'))` em UTC;
- FKs com `ON DELETE SET NULL` ou `CASCADE`;
- enums validados no Zod, não no banco (não há `CHECK`).

### Autenticação e isolamento

- O app é **de um usuário só**. A senha (`APP_PASSWORD`) gera um cookie HttpOnly assinado com HMAC, válido por 180 dias. O MCP usa um token separado (`MCP_TOKEN`), na URL ou no header Bearer, comparado em tempo constante.
- As tabelas não têm `user_id`. O isolamento é um banco por deploy.

### Tempo

- Só existem **datas**, sem horário. O "hoje" do servidor usa o fuso `TIMEZONE`.
- O "hoje" do cliente usa o **fuso do aparelho** (`src/client/state.tsx:58`).

### PWA

- Manifest "Finanças", com atalho `/?novo=gasto`.
- Service worker network-first (`financas-v1`). `/api` e `/mcp` nunca entram no cache.

### Qualidade e release

- `npm run typecheck` passa (verificado nesta auditoria).
- **Não existe nenhum teste automatizado nem script de teste.**
- O release hoje é manual:
  1. exportar o D1 de produção para `backups/` (fora do git);
  2. carregar a cópia localmente;
  3. comparar as saídas da API e do MCP antes e depois da mudança;
  4. aplicar as migrations aditivas com `db:migrate:remote` **antes** do `deploy`.

---

## 2. O que pode ser reaproveitado

| Item | Como será usado |
|---|---|
| Worker único + Hono + `onError` | Novos módulos entram como sub-routers em `/api/<módulo>` e herdam a autenticação |
| Padrão rotas → services → D1, com Zod na entrada do service | Mesmo padrão nos módulos novos. A API e o MCP chamam o mesmo service |
| `Ctx` injetado | Ganha `timezone` e `now` (horário local), sem quebrar quem já usa |
| `UserError`, `updateRow`, `mustGet`, `findByName` | Usados diretamente, inclusive para resolver nomes de projetos e eventos no MCP |
| Servidor MCP (`server.ts`) | Continua o mesmo. Só passa a registrar mais ferramentas |
| Login, sessão e token | Protegem os módulos novos sem mudança (tudo está sob `/api/*` e `/mcp`) |
| `ui.tsx`, `useData`, `useMutation`, toasts, `Sheet`, `confirmDelete` | Base das telas novas. `CheckCircle` já serve para concluir tarefas e treinos |
| Tokens de cor e tema escuro | Mesma identidade visual. Uma cor de destaque por módulo, se fizer sentido |
| `shared/month.ts`, `todayIn` | Base para o novo `shared/datetime.ts` |
| `exportAll` (backup JSON) | Estendido para as tabelas novas |
| Processo de release com snapshot da produção | Formalizado como script na Fase 1 |

---

## 3. Principais riscos técnicos

1. **Não há nenhum teste.** Este é o maior risco. Os módulos novos vão mexer em arquivos compartilhados (`App.tsx`, `state.tsx`, `SheetHost.tsx`, `api.ts`, `mcp/server.ts`, `lib.ts`, `summary.ts`). Uma regressão no financeiro passaria despercebida.
   *Mitigação:* testes de caracterização do financeiro antes de qualquer outra mudança (Fase 1).
2. **`balance.ts` repete as regras do `getSummary`.** O próprio comentário do código pede que os dois fiquem em sincronia, mas nada garante isso.
   *Mitigação:* um teste de invariante, em que a sobra calculada pelo saldo acumulado precisa ser igual à `leftover_cents` do resumo para vários meses.
3. **Não existe data com horário.** A agenda precisa de um modelo novo de data, hora e fuso. Também não é garantido que `Temporal` exista no runtime: o Node 24 local não tem, e o workerd não foi verificado.
   *Mitigação:* um helper próprio com `Intl.DateTimeFormat` (sem dependências), testado com o horário de verão histórico de São Paulo. Em 4/11/2018, por exemplo, 00:00 não existiu.
4. **Limite de 10 ms de CPU por requisição.** A expansão de recorrências e o dashboard precisam ser leves.
   *Mitigação:* evitar bibliotecas pesadas, como `rrule`, e expandir só a janela pedida.
5. **O backup ficaria incompleto em silêncio.** `exportAll` tem uma lista fixa de tabelas (`src/worker/services/summary.ts:159`).
   *Mitigação:* um teste que compara essa lista com `sqlite_master`.
6. **Nome e URL.** O Worker se chama `financas`, e a URL `financas.<subdomínio>.workers.dev` está gravada no PWA instalado e no conector MCP. Renomear o Worker troca a URL e quebra os dois.
   *Recomendação:* mudar só o nome exibido (title, manifest, login) para "LifeOS".
7. **O fuso do cliente é diferente do fuso do servidor.** Em viagem, ou com o aparelho em outro fuso, o "hoje" do app e o do MCP divergem, e isso passa a importar com a agenda.
   *Mitigação:* o cliente passa a usar o fuso configurado no servidor.
8. **O escopo do token MCP aumenta.** Hoje o link do conector dá acesso só às finanças. Com os módulos novos, o mesmo link vai ler e alterar agenda, tarefas e treinos. Para uso pessoal é aceitável, mas a decisão precisa ser consciente (veja as decisões pendentes).
9. **Não falta espaço na navegação do desktop, mas falta no celular.** A barra inferior tem 4 destinos mais o "+", e o LifeOS terá Hoje, Agenda, Tarefas, Treinos e Finanças.
10. **As migrations do D1 só andam para frente** (o wrangler não tem "down").
    *Mitigação:* criar só tabelas novas, sem tocar nas do financeiro. O rollback é o código anterior, que ignora as tabelas novas, mais um `DROP TABLE` documentado se for preciso.
11. **Chamadas MCP repetidas duplicam registros.** Hoje, chamar `lancar_despesa` duas vezes cria dois gastos. Nos módulos novos isso precisa ser tratado (veja a Fase 5).
12. **Não há infraestrutura para entregar lembretes** (nem Web Push, nem Cron Trigger configurado). Lembretes ficam fora do MVP. Armazenar uma configuração que não faz nada só confunde.

---

## 4. Arquitetura incremental proposta

### Princípio: monólito modular, mesmo Worker e mesmo D1

**Por quê:** é um único usuário e um único deploy, sem custo e com um backup só. O D1 também permite transação (`batch`) entre entidades relacionadas, como um bloco de agenda e a tarefa dele. A separação entre domínios é **lógica** (pastas e regras de dependência), não física. Nada justifica mais de um Worker ou mais de um banco agora.

### Regras de dependência

1. Cada módulo novo é dono das suas tabelas. **Nenhum módulo faz SQL na tabela de outro.** Quando precisa de dados de outro módulo, chama uma função exportada pelo service dele.
2. A composição fica em um módulo **só de leitura**, `today`. É ele que monta a agenda unificada, o dashboard e as revisões diária e semanal. O financeiro entra só via `getSummary` e não tem a fórmula duplicada.
3. **O financeiro fica onde está** (`services/`, `api.ts`, `mcp/tools.ts`). Mover para `modules/finance/` pode ser feito depois, só com `git mv`, quando houver testes cobrindo.
4. API e MCP de cada módulo chamam o mesmo service, como já acontece no financeiro.

### Agenda como composição, sem cópias

A agenda mostra três tipos de item, cada um apontando para a entidade dona:

| Item na agenda | Dono | Como aparece |
|---|---|---|
| Evento (inclui recorrentes) | `events` | Linha própria |
| Bloco de tempo para uma tarefa | `events` com `task_id` | Evento ligado à tarefa. O status de conclusão continua na tarefa |
| Treino planejado | `training_sessions` | Projetado na agenda pela data e hora do treino. **Não há linha em `events`** |
| Prazo de tarefa | `tasks.due_date` | Marcador de dia inteiro. **Não ocupa horário** |

`GET /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD` devolve uma lista de `AgendaItem` com `kind: "event" | "training" | "task_due"`, cada um com o id da entidade de origem.

### Data, hora e fuso

- Os eventos guardam **horário local** (`'YYYY-MM-DDTHH:MM'`) mais o **fuso IANA** do evento.
  - **Por quê:** recorrência e dia inteiro são conceitos de relógio de parede. "Toda segunda às 09:00" continua às 09:00 quando o horário de verão muda, e é assim que o padrão iCalendar trata recorrência com fuso.
- O UTC é **derivado** quando for necessário (lembretes ou exportação ICS no futuro). As consultas por intervalo usam as strings locais, o que está correto enquanto todos os eventos estiverem no fuso do app.
  - Se um dia houver eventos em vários fusos, basta acrescentar uma coluna `start_utc` em uma migration aditiva.
- Novo `src/shared/datetime.ts`, sem dependências: `nowIn(tz)`, `zonedToUtc(local, tz)`, `utcToZoned(iso, tz)`, `addDays`, `startOfWeek` (segunda-feira) e validação de horário inexistente ou ambíguo na mudança de horário.
- O fuso fica em `settings.timezone` (padrão: `env.TIMEZONE`), pronto para ser configurado no futuro.

### Recorrência

- Um subconjunto da RRULE (RFC 5545), interpretado em `src/shared/recurrence.ts`: `FREQ=DAILY|WEEKLY|MONTHLY|YEARLY`, `INTERVAL`, `BYDAY` (semanal), `COUNT` e `UNTIL`.
  - **Por que não a biblioteca `rrule`:** ela é maior do que precisamos e pesa no limite de CPU. O subconjunto cobre o que o MVP pede e é fácil de testar.
- **As ocorrências são virtuais**: são calculadas para a janela pedida e nunca gravadas, então não há como duplicar.
- Uma ocorrência alterada ou cancelada vira uma linha em `events` com `series_id` e `original_start`, como faz o Google Calendar. Um **índice único** em `(series_id, original_start)` impede duplicatas ao editar a mesma ocorrência duas vezes.
- **Editar ou excluir:**
  - *Só esta:* grava ou atualiza a linha de exceção. Excluir marca `cancelled = 1`.
  - *Esta e as seguintes:* encerra a série original (`UNTIL` antes da ocorrência) e cria uma série nova a partir dela, tudo em uma transação (`batch`).
  - *Todas:* atualiza a linha mestre. Se o horário ou a regra mudarem, as exceções futuras são descartadas, e a interface e o MCP avisam antes.

### Estrutura de pastas proposta

```
migrations/
  0005_tasks.sql                 projects, tasks
  0006_agenda.sql                events
  0007_training.sql              training_sessions
  0008_activity_log.sql          activity_log
src/shared/
  datetime.ts                    data/hora local + fuso (novo)
  recurrence.ts                  expansão de RRULE (novo)
  tasks.ts, agenda.ts, training.ts   tipos e regras puras de cada módulo (como receivables.ts)
src/worker/
  modules/
    tasks/     service.ts  routes.ts  tools.ts
    agenda/    service.ts  routes.ts  tools.ts
    training/  service.ts  routes.ts  tools.ts
    today/     service.ts  routes.ts  tools.ts    composição (agenda unificada, dashboard, revisões), só leitura
  mcp/tool.ts                    tipo Tool + helper tool(), extraídos de tools.ts
  services/ api.ts mcp/tools.ts  financeiro (inalterado)
src/client/
  modules/
    today/     TodayView.tsx
    agenda/    AgendaView.tsx (dia/semana/mês), EventForm.tsx
    tasks/     TasksView.tsx, TaskForm.tsx, ProjectForm.tsx
    training/  TrainingView.tsx (semana + histórico), TrainingForm.tsx, ResultForm.tsx
  views/ forms/                  financeiro (inalterado)
test/                            testes (Vitest)
```

### Pontos de contato com o código do financeiro

São mudanças pequenas e cobertas por testes antes de acontecer:

| Arquivo | Mudança |
|---|---|
| `src/worker/api.ts` | `api.route("/tasks", …)`, `api.route("/agenda", …)` etc. |
| `src/worker/mcp/server.ts` | Lista de ferramentas = financeiras + novas. As instruções ganham uma seção por módulo |
| `src/worker/mcp/tools.ts` | Só passa a importar `Tool`/`tool()` de `mcp/tool.ts`. Nenhuma ferramenta muda |
| `src/worker/lib.ts` | `Ctx` ganha `timezone` e `now` |
| `src/worker/services/summary.ts` | `exportAll` inclui as tabelas novas (`version: 4`) |
| `src/client/App.tsx`, `state.tsx`, `SheetHost.tsx` | Navegação e modais dos módulos |
| `index.html`, `public/manifest.webmanifest` | Nome exibido "LifeOS". O nome do Worker e a URL continuam |

### Navegação (proposta)

- **Rotas por hash.** As rotas do financeiro continuam iguais (`#/summary`, `#/expenses/…`, `#/receivables`, `#/goals`, `#/settings`), então nenhum link ou atalho quebra. As rotas novas são `#/today`, `#/agenda/<dia|semana|mes>?d=YYYY-MM-DD`, `#/tasks/<hoje|proximas|atrasadas|concluidas>` e `#/training/<semana|historico>`.
- **Desktop (sidebar):** Hoje · Agenda · Tarefas · Treinos · Finanças (Resumo, Gastos, Devedores, Metas) · Ajustes. O botão "Novo" abre um modal com as abas Tarefa · Evento · Treino · Gasto, mais as abas financeiras que já existem.
- **Celular:** é uma decisão pendente (veja a seção 9). Recomendo **Hoje · Agenda · ＋ · Tarefas · Mais**, com Treinos, Finanças e Ajustes em "Mais". "Hoje" já mostra o treino do dia e o resumo financeiro, com links, e "＋" continua lançando um gasto em dois toques.
- **Finanças** ganha uma barra de sub-abas (Resumo · Gastos · Devedores · Metas). O `MonthSwitcher` continua só nas telas do financeiro, e a agenda tem o seu próprio navegador de datas.
- **O destino inicial passa a ser "Hoje"** quando houver conteúdo real (Fase 2). Até lá continua sendo o Resumo.

---

## 5. Modelo de dados proposto

O modelo segue as convenções do banco atual. Todas as migrations são **aditivas**: só criam tabelas novas e não alteram as do financeiro. Os enums são validados no Zod, como no código atual. Não uso `CHECK`, porque no SQLite mudar um `CHECK` exige reconstruir a tabela.

### Tarefas e projetos (`0005_tasks.sql`)

```sql
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
  due_date         TEXT,              -- prazo (dia). Não ocupa horário na agenda
  estimate_minutes INTEGER,
  tags             TEXT,              -- JSON array de etiquetas (filtro com json_each)
  project_id       INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  parent_id        INTEGER REFERENCES tasks(id) ON DELETE CASCADE, -- subtarefa (um nível)
  completed_at     TEXT,              -- preenchido ao concluir; limpo ao reabrir
  created_at       TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tasks_open    ON tasks(status, due_date);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent  ON tasks(parent_id);
```

**Regras no service:**

- `status = 'done'` se e somente se `completed_at` estiver preenchido.
- Reabrir uma tarefa limpa `completed_at` e mantém todo o resto. A transição fica registrada em `activity_log`, então o histórico não se perde.
- As subtarefas têm um nível só. O progresso da tarefa é o número de subtarefas concluídas sobre o total.
- Concluir uma tarefa com subtarefas abertas pede confirmação e conclui todas juntas.
- **Ordenação:** atrasadas primeiro, depois prioridade (alta → baixa), depois prazo, sem prazo por último.
- **Listas derivadas:** Hoje (prazo ≤ hoje, ou com bloco hoje na agenda), Próximas, Atrasadas e Concluídas.

**Por que `tags` em JSON e não uma tabela de junção:** o MVP só precisa filtrar por etiqueta, e o `json_each` resolve. Se as etiquetas ganharem cor, ordem ou renomeação em massa, uma tabela `tags` entra em uma migration aditiva.

### Agenda (`0006_agenda.sql`)

```sql
CREATE TABLE events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  title          TEXT    NOT NULL,
  description    TEXT,
  location       TEXT,
  url            TEXT,                 -- link da reunião
  category       TEXT,
  color          TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0,
  start_at       TEXT    NOT NULL,     -- horário local 'YYYY-MM-DDTHH:MM' no fuso `timezone` (dia inteiro: T00:00)
  end_at         TEXT    NOT NULL,     -- exclusivo (dia inteiro: T00:00 do dia seguinte ao último dia)
  timezone       TEXT    NOT NULL DEFAULT 'America/Sao_Paulo',
  rrule          TEXT,                 -- recorrência (subconjunto RFC 5545), só na linha mestre da série
  series_id      INTEGER REFERENCES events(id) ON DELETE CASCADE, -- esta linha é uma ocorrência alterada/cancelada de uma série
  original_start TEXT,                 -- início original da ocorrência substituída
  cancelled      INTEGER NOT NULL DEFAULT 0,
  task_id        INTEGER REFERENCES tasks(id) ON DELETE SET NULL, -- bloco de tempo para uma tarefa
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_events_range ON events(start_at, end_at);
CREATE UNIQUE INDEX idx_events_occurrence ON events(series_id, original_start) WHERE series_id IS NOT NULL;
CREATE INDEX idx_events_task ON events(task_id);
```

**Regras:**

- `end_at > start_at`. Em evento de dia inteiro, as duas pontas são `T00:00`.
- Horários que não existem por causa do horário de verão são recusados com uma mensagem clara.
- Excluir uma tarefa **não** apaga o bloco na agenda: ele vira um evento comum, para manter o histórico do que foi planejado.
- Lembretes ficam fora do MVP. Quando houver entrega (Cron Trigger mais Web Push), entra uma coluna `reminder_minutes` em migration aditiva.

### Treinos (`0007_training.sql`)

```sql
CREATE TABLE training_sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sport              TEXT    NOT NULL,      -- run | bike | swim | strength | other
  title              TEXT,                  -- ex.: "Longão", "Intervalado 6x800", "Treino A"
  workout_type       TEXT,                  -- easy | long | intervals | tempo | recovery | race | strength | other
  date               TEXT    NOT NULL,      -- dia do treino (o planejado; ou o realizado, se foi avulso)
  time               TEXT,                  -- 'HH:MM' planejado (opcional): se houver, aparece com horário na agenda
  planned            INTEGER NOT NULL DEFAULT 1, -- 0 = registrado sem planejamento (fora do % de cumprimento)
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
  rpe                INTEGER,               -- percepção de esforço, 1–10
  notes              TEXT,
  created_at         TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_training_date ON training_sessions(date);
```

**Decisões de modelagem:**

- **Planejado e realizado ficam na mesma linha, em colunas separadas** (`planned_*` e `actual_*`). Registrar o resultado é um UPDATE, então não existe como duplicar o treino ao marcá-lo como feito. O plano original continua intacto para comparar com o realizado.
- **Unidades inteiras:** segundos e metros, seguindo a mesma lógica dos centavos. A interface mostra km, min:s e m (natação).
- **O ritmo médio não é gravado.** Ele é derivado de duração ÷ distância, porque gravar seria redundante e poderia ficar inconsistente.
- **Exercícios, séries e repetições não viram tabela agora.** No MVP basta o texto livre em `instructions`. Uma tabela `training_exercises (session_id, name, sets, reps, load)` pode entrar depois, de forma aditiva, quando houver necessidade de gráficos de carga.

**Transições de status:**

| De | Para | Regra |
|---|---|---|
| `planned` | `done` / `partial` | Exige um resultado (duração ou distância realizada) |
| `planned` | `skipped` | Não realizado. Conta como falta no % de cumprimento |
| `planned` | `cancelled` | Desmarcado com antecedência. Sai do denominador do % |
| `done` ↔ `partial` | | Ao editar o resultado |
| `done` / `partial` | `planned` | "Desfazer registro": limpa os `actual_*`, com confirmação |
| `skipped` / `cancelled` | `planned` | Reabrir |

- Registrar resultado em um treino que já está `done` atualiza a mesma linha (idempotente).
- Um treino planejado no passado sem registro aparece como **"sem registro"**. Isso é calculado na hora; o status não muda sozinho.

**Indicadores da semana (segunda a domingo):**

- treinos planejados (`planned = 1` e `status != 'cancelled'`);
- treinos realizados (`done` + `partial`);
- % de cumprimento = realizados ÷ planejados até hoje;
- volume por modalidade (duração e distância);
- duração total;
- planejado × realizado.

### Histórico e auditoria (`0008_activity_log.sql`)

```sql
CREATE TABLE activity_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  at        TEXT    NOT NULL DEFAULT (datetime('now')),
  source    TEXT    NOT NULL,   -- app | mcp
  action    TEXT    NOT NULL,   -- ex.: task.completed, task.reopened, training.status, mcp.call
  entity    TEXT,               -- task | event | training | expense | ...
  entity_id INTEGER,
  detail    TEXT                -- JSON curto. Nunca tokens ou segredos
);
CREATE INDEX idx_activity_entity ON activity_log(entity, entity_id);
```

A tabela tem dois usos:

1. **Histórico de domínio:** os services dos módulos novos registram transições, como concluir e reabrir tarefas ou mudar o status de treinos.
2. **Auditoria do MCP:** o `server.ts` registra cada chamada de ferramenta que altera dados, com nome, argumentos e resultado (ok ou erro). Isso vale também para as ferramentas do financeiro, **sem alterar o código delas**.

---

## 6. Plano de implementação por etapas

Cada fase termina com: testes passando, `typecheck` limpo, verificação no navegador (desktop e mobile) e um relatório (o que foi feito, arquivos e migrations, decisões, testes e resultados, problemas conhecidos, próximos passos). Não avanço para uma fase que dependa de uma decisão não aprovada.

### Fase 1: fundação e navegação

1. **Infraestrutura de testes.** Vitest 4.1 e `@cloudflare/vitest-pool-workers` 0.23 como devDependencies, sem custo em produção. Verifiquei os peerDependencies: o pool exige `vitest ^4.1`, e o Vitest 4.1 aceita Vite 8. O D1 dos testes roda em memória, com as **migrations reais** aplicadas. Script `npm test`.
2. **Testes de caracterização do financeiro** (lista na seção 7). Eles usam uma fixture com **datas fixas**, porque o `seed/example.sql` usa datas relativas a "hoje" e não serve para snapshot.
3. **`src/shared/datetime.ts`** e seus testes (horário de verão de 2018 em São Paulo, meia-noite, virada de ano, início de semana).
4. **MCP:** extrair `Tool` e `tool()` para `mcp/tool.ts`. Um teste garante que o `tools/list` das 19 ferramentas financeiras é idêntico antes e depois.
5. **`exportAll`:** passa a incluir todas as tabelas, com um teste contra `sqlite_master`.
6. **`Ctx`** ganha `timezone` e `now`. O `/api/me` devolve `today` e `timezone`, e o cliente passa a usar o fuso do servidor.
7. **Navegação:** sidebar com grupos e Finanças com sub-abas, mantendo as rotas atuais. Nome exibido "LifeOS".
8. **Script de snapshot do release:** gera as saídas da API e do MCP a partir de um banco local (cópia do backup da produção) para comparar antes e depois. É o processo atual, que hoje é manual.

### Fase 2: tarefas e agenda

As tarefas vêm primeiro porque os blocos da agenda referenciam tarefas.

1. **Migrations** `0005_tasks.sql` e `0006_agenda.sql`.
2. **Service de tarefas:** CRUD, concluir e reabrir, subtarefas, listas (Hoje, Próximas, Atrasadas, Concluídas), filtros (status, prioridade, prazo, projeto, etiqueta), ordenação e progresso. Projetos com CRUD simples.
3. **`shared/recurrence.ts`** e seus testes. **Service da agenda:** CRUD, expansão por janela, edição e exclusão de ocorrência nos três modos, validação e blocos de tarefa.
4. **`modules/today`:** `GET /api/agenda` unificado (eventos e prazos de tarefas; os treinos entram na Fase 3).
5. **Interface:**
   - Tarefas: listas, filtros, conclusão rápida, formulário em Sheet.
   - Agenda: visões de dia, semana e mês, navegação entre períodos, lista de próximos e formulário.
   - Estados de carregando, vazio e erro em todas as telas.
6. **"Hoje" (primeira versão):** compromissos de hoje e tarefas prioritárias ou atrasadas. Passa a ser a tela inicial.

### Fase 3: treinos

1. **Migration** `0007_training.sql`.
2. **Service:** planejar, registrar resultado, transições de status, indicadores da semana e histórico.
3. **Interface:**
   - Semana: planejar por dia e ver planejado × realizado.
   - Registrar resultado.
   - Histórico com filtro por modalidade.
4. **Integração:** os treinos entram na agenda unificada e em "Hoje".

### Fase 4: dashboard integrado

- **"Hoje" completo:**
  - data;
  - próximos compromissos;
  - tarefas prioritárias e atrasadas;
  - treino do dia;
  - resumo financeiro do mês, via `getSummary`: total de gastos, sobra prevista, saldo final previsto e orçamentos estourados;
  - atalhos para criar tarefa, evento, treino e gasto.
- **Visão da semana:** compromissos, tarefas concluídas e treinos planejados × realizados.
- **Performance:** checar o tempo de CPU no observability do Workers.

### Fase 5: MCP e IA

**Ferramentas novas** (nomes e argumentos em pt-BR, como as atuais):

| Módulo | Ferramentas |
|---|---|
| Agenda | `agenda` (consultar hoje, amanhã, semana ou intervalo), `criar_evento`, `editar_evento` (escopo: esta, seguintes, todas), `cancelar_evento` |
| Tarefas | `listar_tarefas`, `criar_tarefa`, `editar_tarefa`, `concluir_tarefa` (também reabre), `remover_tarefa` |
| Treinos | `treinos_semana`, `planejar_treino`, `registrar_treino` (preenche o planejado ou cria um avulso), `status_treino` |
| Revisões | `revisao_diaria`, `revisao_semanal` (só leitura, incluem o resumo financeiro) |

**Segurança:**

- **Validação no servidor:** Zod em todos os argumentos, como já é feito hoje.
- **Sem acesso direto ao banco:** as ferramentas só chamam services. Não existe SQL vindo do modelo.
- **Ambiguidade:** usa `findByName`, que devolve erro listando as opções.
- **Idempotência:**
  - `registrar_treino` e `concluir_tarefa` são UPDATEs, portanto idempotentes.
  - Nas criações, se um registro idêntico (mesmos campos principais) foi criado nos últimos 10 minutos, a ferramenta devolve o existente com o aviso "já existia".
- **Confirmação:**
  - As ferramentas destrutivas têm `destructiveHint`.
  - Operações em massa ou irreversíveis (por exemplo, excluir uma série inteira) exigem `confirmar: true`. Sem esse parâmetro, a ferramenta só devolve uma prévia do que seria feito. A confirmação é **imposta pelo servidor**, não só pedida nas instruções.
- **Auditoria:** cada chamada que altera dados vai para `activity_log`, sem tokens.
- **Saída:** texto claro com os ids (padrão atual) e o que foi executado.

**Instruções do servidor:** ganham uma seção por módulo. A URL e o token continuam os mesmos.

### Fase 6: estabilização

- **Acessibilidade:** foco preso no Sheet, navegação por teclado e `aria` nos controles novos.
- **UX mobile:** revisão das telas no celular.
- **Erros e estados vazios:** revisão em todas as telas.
- **Documentação:** README (seções LifeOS, MCP e estrutura).
- **Release:**
  1. backup da produção;
  2. snapshot antes e depois;
  3. `db:migrate:remote`;
  4. `deploy`.

---

## 7. Testes para proteger o financeiro

### Unitários (funções puras)

- `referenceMonth`, com uma matriz de casos:
  - sem conta e conta de débito;
  - crédito antes, no dia e depois do fechamento;
  - `due_day ≤ closing_day`;
  - `payment_day > due_day`;
  - virada de ano.

  Inclui os dois perfis de cartão usados hoje, com valores fictícios: fecha 24, vence 1, paga 25; e fecha 27, vence 3, paga 27.
- `addMonths`, `monthDiff` e `parseMoney` (`"32,50"`, `"1.234,56"`, `"1234.56"`, `"R$ 10"`, `"1.234"`, inválidos).
- `splitAmounts`, `isDue`, `decorateGoal` (aporte planejado, previsão, aporte necessário) e o `decorate` de parcelados.

### Integração (D1 real em memória, com as migrations)

- **`getSummary`** com a fixture, para três meses (anterior, atual e futuro): totais, `by_account`, orçamentos (inclusive estourados), devedores por pessoa (com parcelas futuras) e saldo. Validado por snapshot.
- **Invariante saldo × resumo:** `getMonthBalance(m).leftover_cents === getSummary(m).totals.leftover_cents` para vários meses (com renda configurada).
- **`getMonthBalance`:**
  - encadeamento entre meses;
  - ajuste manual e volta ao automático;
  - mês anterior ao início devolve `null`.
- **`createExpense` com divisão:**
  - gasto e devedores criados na mesma transação, com `expense_id` ligado e a parte do usuário correta;
  - erro quando a soma das partes passa do total.
- **`deleteExpense`:** remove só os devedores ainda não recebidos.
- **Devedor parcelado:** criação das parcelas e `markReceived` só nas que já venceram.
- **Fixos:** ajuste do mês, marcar como pago e voltar ao valor padrão.
- **`exportAll`:** cobre todas as tabelas do `sqlite_master`.

### API e MCP

- `/api/*` sem cookie devolve 401. `/mcp/<token inválido>` devolve 401.
- `tools/list`: os nomes e schemas das 19 ferramentas financeiras não mudam (snapshot).
- `tools/call resumo_mes` com a fixture: snapshot do texto.

### Release

O snapshot da cópia local da produção é comparado antes e depois de cada fase que mexe em arquivo compartilhado.

---

## 8. Fora do MVP

- Notificações push e lembretes.
- Sincronização com Google Calendar ou Outlook.
- Importação de treinos (Strava, Garmin).
- Tarefas recorrentes.
- Prescrição automática de treino.
- Tabelas de exercícios e séries.
- Vários usuários.
- Vários fusos por evento (o modelo já está preparado).

---

## 9. Registro de execução

### Fase 1 (11/10/2026): concluída

Ajustes em relação ao plano:

- **Pacote de testes.** O `@cloudflare/vitest-pool-workers` foi descontinuado e renomeado para `@cloudflare/vitest-plugin`. Usei a versão 1.3.6, que depende exatamente do mesmo wrangler (4.147.0) e workerd do projeto, então nada fica duplicado.
- **Backup.** A lista de tabelas do `exportAll` continua fixa, e um teste exige que ela cubra todas as tabelas do banco. Uma lista lida do `sqlite_master` em produção poderia incluir tabelas internas do D1 (`_cf_*`) e quebrar o backup.
- **Adiado para quando houver uso, na Fase 2:**
  - extrair `Tool` e `tool()` para `mcp/tool.ts`;
  - adicionar `Ctx.now`;
  - criar `settings.timezone` (por enquanto, o fuso vem de `env.TIMEZONE`).
- **Barra inferior do celular.** Fica igual até a Fase 2, porque ainda não existem Hoje, Agenda e Tarefas para preencher a barra nova.
- **Verificação.** Os testes de caracterização foram rodados também contra o código da `main`. Passam todos, exceto as duas mudanças intencionais (`/api/me` e `datetime.ts`), o que confirma que descrevem o comportamento de produção.

### Fase 2 (11/10/2026): concluída

Ajustes em relação ao plano:

- **Numeração das migrations.** O histórico (`activity_log`) entrou já nesta fase como `0007`, porque concluir e reabrir tarefas precisa dele. Treinos fica com a `0008`.
- **`Ctx` ganhou `now` e `source`.** `now` é a hora local; `source` indica se a ação veio do app ou do MCP e vai para o histórico.
- **`/api/today` já existe.** A composição da tela Hoje (agenda e tarefas) foi para o servidor nesta fase. As Fases 3 e 4 só acrescentam treino, finanças e a semana.
- **Visões da agenda.** Semana e dia são listas por dia, e o mês é uma grade. Não fiz grade de horários (estilo Google Calendar), por ser mais pesada no celular. Fica como evolução se fizer falta.
- **Tarefas recorrentes e lembretes** continuam fora do MVP.

### Fase 3 (11/10/2026): concluída

Ajustes em relação ao plano:

- **Coluna `unplanned`.** Para o treino registrado sem planejamento, a coluna se chama `unplanned` (1 = sem plano), em vez de `planned`, para não confundir com o status "planejado".
- **Cumprimento.** O treino de hoje ainda pendente não conta como falta: entra na conta só depois de registrado (feito ou não realizado), ou a partir de amanhã.
- **"Feito conforme o planejado".** Ao marcar como realizado sem informar números, o resultado copia duração e distância do plano. O plano continua guardado em colunas próprias.
- **`recordWorkout`.** Já existe para o MCP da Fase 5. Se houver um treino planejado da modalidade no dia, ele é preenchido; senão, é criado um treino sem plano. Se houver dois planejados iguais no dia, pergunta qual.
- **"Copiar o plano da semana anterior".** Acrescentei esse atalho para o planejamento semanal. Os cancelados e os sem plano não são copiados.

### Fase 4 (11/10/2026): concluída

- **Finanças em Hoje.** `getFinance` só lê o `getSummary`: gastos do mês, sobra prevista, saldo final previsto, a receber e orçamentos que estouraram ou passaram de 85%. Um teste exige que os números sejam idênticos aos do resumo.
- **`/api/week`.** Junta compromissos da semana, tarefas concluídas (pela data de conclusão), tarefas com prazo na semana, atrasadas e os indicadores de treino. A mesma função vai servir à revisão semanal do MCP.
- **Tela Hoje.** Tem atalhos (Tarefa, Evento, Treino, Gasto), quatro indicadores clicáveis e as seções do dia, de finanças e da semana.

### Fase 5 (11/10/2026): concluída

- **Ferramentas novas:** 17, além das 19 de finanças. Nomes e parâmetros em português, cada módulo com o seu `tools.ts`, e `mcp/tool.ts` com a definição comum.
- **Confirmação imposta pelo servidor.** `remover_tarefa`, `cancelar_evento` e `remover_treino` só excluem com `confirmar: true`. Sem isso, devolvem uma prévia sem erro, para o Claude perguntar ao usuário.
- **Deduplicação.** `criar_tarefa`, `criar_evento` e `planejar_treino` devolvem o registro igual criado nos últimos 10 minutos, em vez de duplicar. `concluir_tarefa` e `registrar_treino` são idempotentes por natureza (atualizam o registro).
- **Auditoria.** Toda chamada que pode alterar dados, inclusive as de finanças, vai para `activity_log` com ferramenta, parâmetros, se deu certo e o começo da resposta. Fica só no banco, nada vai para os logs do Worker. Consultas não são auditadas.
- **Nome do servidor.** `serverInfo` passou a "lifeos". A URL e o token não mudam, então o conector continua funcionando.
- **Datas e horários.** Aceitam "hoje", "amanhã", "DD/MM", "9h" e "14h30", para o Claude não precisar calcular.

## 10. Decisões aprovadas (11/10/2026)

1. **Barra inferior no celular:** Hoje · Agenda · ＋ · Tarefas · Mais (Treinos, Finanças, Ajustes).
2. **Nome e URL:** o app passa a se chamar "LifeOS" na tela. O Worker continua `financas`, com a mesma URL, então o PWA instalado e o conector continuam funcionando.
3. **Conector MCP:** um conector só, com todas as ferramentas (mesma URL e token).
4. **Ordem da Fase 2:** tarefas antes da agenda.
5. **Testes:** Vitest e `@cloudflare/vitest-pool-workers` como devDependencies.
6. **Repositório:** um só, o atual. Um único pacote npm, com os módulos separados em pastas, sem workspaces. Cada fase é desenvolvida em uma branch própria e entra na `main` por PR. A `main` continua sempre pronta para deploy.
