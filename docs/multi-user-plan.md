# LifeOS para várias pessoas: discovery e plano

Data: 26/10/2026. Base: `main` + PR #10 (página dos devedores).
Status: **plano aprovado em 26/10/2026**, com as premissas da seção 8 confirmadas. Execução começando pela fase 1.

O que está descrito como "atual" foi verificado no código. O que é proposta está marcado como tal.

---

## 1. Objetivo

Pessoas próximas (amigos, família) usam o LifeOS com contas próprias e todas as funcionalidades: finanças, agenda, tarefas, treinos e o Claude via MCP. Além disso, as contas se conectam:

- Você lança uma compra de R$ 200 dividida com a Ana: a parte dela aparece na hora na conta dela, como algo que ela deve a você.
- Eventos, tarefas e metas podem ser compartilhados entre contas.

## 2. Decisões já tomadas (26/10/2026)

| Tema | Decisão |
|---|---|
| Público | Só convidados, até ~20 pessoas. Você é o admin. Custo continua zero |
| Login | Passkey (Face ID/digital) + convite por link de uso único |
| Parte dividida, na conta de quem deve | Aparece em "Devo" e **soma nos gastos dela no mês da sua fatura** (o mesmo mês em que o item entra para você) |
| O que mais é compartilhado | Eventos da agenda, tarefas e metas em conjunto |

## 3. O que hoje assume um único dono (discovery)

| Onde | Como é hoje | Impacto |
|---|---|---|
| Banco (16 tabelas) | Nenhuma tabela tem dono (`user_id`) | Toda tabela precisa de dono |
| `settings` | Chave global (`key` é a chave primária): salário, mês inicial do saldo | Precisa ser por pessoa: nova tabela |
| `month_balances` | Chave primária é só o `month` | Precisa ser por pessoa: nova tabela |
| Consultas | 102 chamadas SQL em `services/*` e `modules/*/service.ts`, nenhuma filtra por pessoa | Todas passam a filtrar por `user_id`. É o maior trabalho e o maior risco |
| `lib.ts` | `mustGet`, `updateRow` e `makeCtx` são centrais | Bom ponto para aplicar o dono automaticamente |
| `Ctx` | `{ db, today, month, timezone, now, source }`, montado de `env` | Ganha `userId`. Fuso vem da pessoa, não de `env.TIMEZONE` |
| Login | Senha única `APP_PASSWORD`; o cookie é assinado com ela e não diz quem é | Sessão passa a carregar a pessoa |
| MCP | Um token só (`MCP_TOKEN`), na URL ou no header | Um token por pessoa, guardado com hash no banco |
| Ajustes → conector | Mostra a URL com o `MCP_TOKEN` | Mostra o token da pessoa logada |
| Backup (`/api/export`) | `SELECT *` de todas as tabelas | Só os dados de quem pediu |
| `activity_log` | Sem dono | Ganha dono |
| Devedores | `receivables.person` é texto livre ("Ana") | Precisa ligar o nome a uma conta |
| `/devedor` (PR #10) | Código por pessoa nas secrets | Continua para quem não tem conta |

O que ajuda:

- Os serviços já recebem tudo por um `Ctx` injetado.
- As regras de finanças estão concentradas em `summary.ts` e `balance.ts`.
- Existem 168 testes rodando no runtime do Workers.

## 4. Estratégias avaliadas

| | Como funciona | Prós | Contras |
|---|---|---|---|
| A. Uma cópia por pessoa | Cada um publica o próprio Worker | Isolamento total | Cada pessoa precisa de conta na Cloudflare e de saber publicar. **Sem conexão entre contas** (o principal pedido) |
| B. Um banco D1 por pessoa | Um binding por pessoa no `wrangler.jsonc` | Isolamento forte | Plano gratuito permite **10 bancos**. Cada pessoa nova exige editar a config e publicar de novo. Dívidas entre contas viram consultas entre bancos |
| C. Um Durable Object por pessoa | Banco SQLite dentro de cada objeto | Isolamento forte, cria na hora | Reescreve as 102 consultas para outra API, e migrações e backup ficam por objeto. É a migração de tecnologia que o projeto evita |
| **D. Um banco, com dono em cada linha** (recomendada) | `user_id` em todas as tabelas, e toda consulta filtra por ele | Mesma stack, migrações só aditivas, custo zero. Conexões entre contas viram consultas simples | Uma consulta esquecida sem filtro vaza dados de outra pessoa. Mitigação na seção 5.2 |

**Recomendação: D.** É evolução incremental, com o mesmo fluxo de release de hoje.

## 5. Proposta

### 5.1 Identidade e login

**Tabelas novas:**

- `users`: id, nome, e-mail opcional, fuso, `role` (admin/member), `session_version`, `created_at`, `disabled_at`.
- `passkeys`: credencial WebAuthn por pessoa (id da credencial, chave pública, contador, aparelho, último uso).
- `invites`: hash do token, quem convidou, para quem, validade de 7 dias, uso único. Serve também como **link de recuperação** de quem já tem conta.
- `mcp_tokens`: hash SHA-256 do token, pessoa, nome e último uso. Uma pessoa pode ter mais de um token e revogar cada um.

**Fluxos:**

- **Convite:** você gera o link em Ajustes → Pessoas e manda pelo WhatsApp. A pessoa abre `/convite/<token>`, informa o nome e cadastra a passkey com Face ID ou digital. A conta nasce conectada a você.
- **Entrar:** botão "Entrar com passkey". Não precisa digitar nome: o aparelho mostra as contas salvas. As passkeys sincronizam pelo iCloud ou pelo Google, então funcionam no celular e no computador.
- **Perdeu o acesso:** você gera um link de recuperação. A pessoa cadastra uma passkey nova, e você pode remover as antigas.
- **Sessão:** cookie `HttpOnly` assinado com uma secret nova (`SESSION_SECRET`), contendo a pessoa e a `session_version`. Aumentar a versão derruba todas as sessões dela ("sair de todos os aparelhos").
- **MCP:** `/mcp/<token>` encontra a pessoa pelo hash do token. Cada pessoa adiciona o próprio conector no Claude dela.

**Transição para você:** o login com `APP_PASSWORD` e o `MCP_TOKEN` atual continuam valendo, ligados à pessoa 1 (você). Eles só são desligados depois que sua passkey e seu token novo estiverem funcionando.

**Detalhes técnicos:**

- A verificação de passkey usa `@simplewebauthn/server`, que funciona em Workers. Verificar uma assinatura gasta bem menos CPU que o limite de 10 ms do plano gratuito. Já um hash de senha seguro passaria desse limite: esse é um dos motivos de não usar senha.
- A passkey fica presa ao domínio `financas.clemer.workers.dev`. Se um dia mudar para um domínio próprio, todos precisam cadastrar a passkey de novo, pelo link de recuperação.

### 5.2 Isolamento dos dados (o ponto crítico)

**Migração aditiva:**

- `ALTER TABLE ... ADD COLUMN user_id INTEGER NOT NULL DEFAULT 1` nas 16 tabelas. Todos os dados atuais passam a ser seus (pessoa 1), e o código atual continua funcionando enquanto a migração roda.
- A coluna não tem `REFERENCES`: o SQLite não permite adicionar coluna com chave estrangeira e valor padrão diferente de nulo quando as chaves estrangeiras estão ligadas, e o D1 liga.
- Índices novos começando por `user_id` (por mês, status, data).
- `settings` e `month_balances` mudam de chave primária, então ganham tabelas novas (`user_settings`, `user_month_balances`), copiando os seus dados. As antigas ficam paradas para permitir rollback.

**No código:**

- O `Ctx` ganha `userId`, vindo só da sessão ou do token MCP, nunca do corpo da requisição.
- `mustGet`, `updateRow` e um novo `deleteRow` aplicam `AND user_id = ?` sozinhos.
- Todo `INSERT` grava `user_id`.
- As 102 consultas são revisadas uma a uma.
- O fuso passa a ser por pessoa (era um item adiado do plano do LifeOS).

**Proteções contra vazamento:**

1. **Teste de isolamento:** cria duas pessoas com dados e chama **toda rota da API e toda ferramenta MCP** como a pessoa B. Confere que nada da A aparece e que ids da A respondem 404.
2. **Teste que procura SQL sem dono:** varre `src/worker` em busca de consultas que tocam tabelas com dono sem mencionar `user_id`. Exceções precisam ser explícitas.
3. **Snapshot de release:** sua conta tem que dar resultado idêntico antes e depois de cada fase. Esse é o processo já usado: `resumo_mes` e o script de snapshot.

### 5.3 Conexões entre pessoas

- `connections`: duas pessoas conectadas. O convite já conecta quem convidou com quem entrou, e dá para conectar outras pessoas depois, com aceite.
- `person_links`: liga um nome dos seus devedores ("Ana") à conta de uma pessoa conectada. Usa a mesma chave de nome de `personKey` (PR #10), então "Jose", "josé" e "José" são a mesma pessoa.
- Ao ligar, o histórico com aquele nome (pendentes e pagos) passa a aparecer para ela.

### 5.4 Dívidas compartilhadas (gasto dividido)

**Uma fonte de verdade, sem cópias:**

- A linha em `receivables` continua sendo de quem tem a receber. Ela ganha `debtor_user_id`, preenchido quando o nome está ligado a uma conta.
- A conta de quem deve **lê** essas linhas.
- Se você edita ou apaga, a mudança aparece na hora para ela. Não há sincronização para dar errado.

**Na conta da Ana:**

- Nova lista **Devo**, agrupada por pessoa: em aberto, próximas parcelas e pagos.
- No **Resumo** dela, entra uma linha nova, "Devo a pessoas", que soma nos gastos do mês. O mês é o do item (`receivables.month`), igual ao seu. Parcelas entram cada uma no seu mês.
- Essa regra entra em `getSummary` **e** em `balance.ts`, que precisam continuar iguais.

**Pagamento, nos dois lados:**

- Ela toca **"Paguei"**: o item fica *aguardando confirmação* para você.
- Você **confirma** e o item vira recebido. Você também pode marcar como recebido direto, como hoje.
- Ela pode **contestar** com um motivo; o item fica marcado para você revisar.

**Ao contrário:** quando ela divide uma compra com você, aparece no seu "Devo".

**MCP:**

- `lancar_despesa` com `dividir_com` funciona igual.
- Ferramentas novas: `listar_minhas_dividas` (o que eu devo) e `marcar_paguei`.
- `listar_devedores` passa a mostrar o que está aguardando confirmação.

### 5.5 Agenda, tarefas e metas compartilhadas

**Agenda:**

- `event_participants` (evento, pessoa, status: convidado, aceito, recusado).
- O evento continua sendo de quem criou. Quem foi convidado vê o evento na agenda e aceita ou recusa, mas não edita.
- Em eventos que se repetem, o convite vale para a série.
- A expansão de ocorrências passa a juntar "meus eventos" com "eventos em que sou participante".

**Tarefas:**

- Projetos viram listas que podem ser compartilhadas: `project_members`. Todos os membros veem e editam as tarefas do projeto (ex.: "Casa").
- Tarefas ganham `assignee_user_id`: uma tarefa atribuída a alguém aparece nas Tarefas dessa pessoa.
- Concluir uma tarefa que se repete continua criando a próxima, no mesmo projeto.

**Metas em conjunto:**

- `goal_members` com o aporte mensal planejado de cada um.
- Cada movimentação registra quem fez.
- O saldo da meta é a soma de todos. No Resumo de cada pessoa entram só os aportes **dela**.

### 5.6 Admin, entrada de pessoas novas e operação

- **Ajustes → Pessoas (só admin):** convidar, gerar link de recuperação, desativar alguém, ver o último acesso.
- **Primeiro acesso:** um passo a passo curto para salário, cartões (fechamento, vencimento, dia em que paga) e fuso. O saldo acumulado começa no mês em que a pessoa entrou, como fizemos para você.
- **Backup:** cada pessoa exporta o próprio JSON. A Time Travel do D1 restaura o banco **inteiro**, ou seja, todo mundo junto. Por isso:
  - criar uma importação do JSON por pessoa, para desfazer um erro de uma pessoa só;
  - manter a exportação completa antes de cada deploy, como já fazemos.
- **Privacidade:** você, como admin, consegue ler o banco. Isso precisa estar escrito no convite e numa página curta de privacidade. A pessoa também precisa poder apagar a conta e todos os dados dela.
- **Limites gratuitos:** 20 pessoas usando bastante (~200 requisições por dia cada) dão ~4 mil requisições por dia, contra o limite de 100 mil. O backup de hoje (uma pessoa) tem 73 KB, contra o limite de 500 MB por banco. Folga grande.
- **Proteção contra abuso:** atraso progressivo em convite, recuperação e login, igual ao login de hoje.

## 6. Fases

Cada fase tem a própria branch e o próprio PR contra `main`, e só começa depois que a anterior for aprovada e publicada. Cada deploy segue o mesmo processo:

1. Exportar o banco de produção.
2. Aplicar as migrações aditivas.
3. Publicar.
4. Comparar sua conta antes e depois.

| Fase | Entrega | Para você, muda o quê | Tamanho |
|---|---|---|---|
| 0 | Este documento | Nada | — |
| 1. Base multiusuário | `user_id` em tudo, `Ctx.userId`, as 102 consultas com dono, tabelas novas de configurações e saldos, testes de isolamento | **Nada**: você vira a pessoa 1 e tudo continua igual | G |
| 2. Contas e login | Passkeys, convites, recuperação, sessão por pessoa, token MCP por pessoa, tela Pessoas, primeiro acesso, fuso e backup por pessoa | Você cadastra sua passkey e o novo conector. Depois, a Ana entra como primeira convidada | G |
| 3. Dívidas conectadas | Ligar nome a conta, "Devo" e a linha no Resumo dela, Paguei/Confirmar/Contestar, ferramentas MCP | Dividir com a Ana já aparece para ela | M |
| 4. Agenda compartilhada | Convite para eventos | Convidar alguém para um evento | M |
| 5. Tarefas compartilhadas | Listas compartilhadas e atribuição | Lista "Casa" com alguém | M |
| 6. Metas em conjunto | Metas com membros e aportes por pessoa | Meta de casal ou de viagem | M |
| 7. Opcional | Notificações no celular (Web Push no app instalado, iOS 16.4+) | "Ana marcou como pago" | P |

As fases 4, 5 e 6 são independentes entre si e podem mudar de ordem.

## 7. Riscos

| Risco | Mitigação |
|---|---|
| Uma consulta sem filtro mostra dados de outra pessoa | Teste de isolamento de todas as rotas e ferramentas, teste que procura SQL sem dono, revisão das 102 consultas |
| Sua conta muda de comportamento | Fase 1 sem mudança visível. Snapshot e `resumo_mes` idênticos antes e depois |
| Restaurar o banco desfaz o trabalho de todos | Importação de JSON por pessoa e exportação antes de cada deploy |
| Pessoa perde o celular e a passkey | Passkeys sincronizam na nuvem (iCloud/Google). Se não der, link de recuperação |
| Passkey no app instalado do iPhone | Validar na fase 2, no iPhone com o app na tela inicial, antes de convidar alguém |
| Trocar de domínio invalida as passkeys | Ficar no `workers.dev`. Se mudar, todos usam o link de recuperação |
| Suporte para família e amigos | Primeiro acesso guiado, textos claros e uma convidada piloto (Ana) antes dos outros |
| Limite de 10 ms de CPU | Sem hash de senha. Passkey e HMAC são baratos. O resumo continua em uma leitura agrupada |

## 8. Premissas (confirmadas em 26/10/2026)

1. A dívida aparece na conta da Ana **sem ela precisar aceitar**; ela pode contestar.
2. **Ela marca "Paguei" e você confirma.** Você também pode marcar como recebido direto.
3. Ao ligar "Ana" à conta dela, **o histórico antigo também aparece** para ela.
4. Só quem tem a receber edita a dívida; quem deve só vê, marca "Paguei" ou contesta.
5. Em listas de tarefas compartilhadas, **todos os membros editam**. Em eventos, só quem criou edita.
6. Você, como admin, tem acesso técnico a todos os dados, e isso fica explícito no convite.
7. `/devedor` continua para quem não quer conta. Quem vira usuário deixa de precisar do código.

## 9. Registro de execução

### Fase 1: base multiusuário (26/10/2026)

**O que mudou:**

- **Migração `0010_users_and_owners.sql`, aditiva:**
  - tabela `users`, com a pessoa 1 como admin;
  - `user_id INTEGER NOT NULL DEFAULT 1` nas 14 tabelas com dados;
  - índices começando por `user_id`;
  - `user_settings` e `user_month_balances`, com cópia dos dados de `settings` e `month_balances`. As antigas ficam paradas, para rollback.
- **`Ctx.userId`:** vem só da autenticação (`AppEnv` do Hono). `makeCtx` sem pessoa falha.
- **Acessos atuais ligados à pessoa 1** (`OWNER_USER_ID`): `APP_PASSWORD`, `MCP_TOKEN` e os códigos `DEBTOR_CODE_*`.
- **Consultas:** as 102 consultas filtram por `user_id`, e todo `INSERT` grava o dono.
  - `mustGet` e `updateRow` aplicam o dono sozinhos.
  - Referências a outras linhas no corpo da requisição (conta, orçamento, projeto, tarefa-mãe, tarefa do evento, conta padrão) são validadas como da mesma pessoa.
  - Subconsultas também comparam `user_id`.
- **Backup:** exporta só os dados da pessoa (versão 5).
- **`/api/receivables/access`:** só responde para o dono. Os códigos de devedor são dele.

**Testes:**

- Trava de dono em todos os testes (`test/ownerGuard.ts`).
- Teste de isolamento (`test/isolation.test.ts`), cobrindo as 71 rotas e as 37 ferramentas.
- O teste de backup exige que toda tabela do banco seja classificada como com dono ou sem dono.
- 174 testes passando.
- Duas mutações (uma consulta trocada para `user_id = user_id`) foram pegas pelo teste de isolamento, sem depender da trava.
- O teste de isolamento achou um vazamento real, já corrigido: `/api/receivables/access` mostrava, para outra pessoa, os nomes com código de devedor.

**Ensaio com cópia da produção:**

1. Exportar o banco de produção (26/10, ~15h).
2. Snapshot da API e do MCP com o código no ar.
3. Aplicar a 0010.
4. Snapshot com o código antigo no banco novo (rollback).
5. Snapshot com o código novo no banco novo.

Resultado: os 73 arquivos ficaram idênticos nos três snapshots. A página `/devedor` com o código novo mostra, para uma pessoa com código, os mesmos valores que o resumo.

**Pontos conhecidos:**

- **Ids são globais (autoincremento):** uma pessoa vê ids altos e pode deduzir quantos registros existem no sistema, mas não o conteúdo. Fica assim.
- **Janela entre migrar e publicar:** se uma configuração ou um saldo ajustado for alterado nesse intervalo, fica só nas tabelas antigas. A migração e o deploy devem ser feitos em seguida.
- **Rollback:** a versão anterior lê `settings` e `month_balances`, que não recebem mais alterações depois do deploy.

**Deploy:** cada passo depois do outro.

1. Exportar o banco de produção.
2. `npm run db:migrate:remote` (aplica a 0010).
3. `npm run deploy`.
4. Conferir que o `resumo_mes` ficou igual.

