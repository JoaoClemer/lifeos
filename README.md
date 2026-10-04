# Finanças

Controle financeiro pessoal: app web (funciona no celular como app instalado) + servidor MCP para lançar gastos conversando com o Claude.

**Custo: R$ 0.** Roda no plano gratuito da Cloudflare (Workers + banco D1), com endereço fixo `https://financas.<sua-conta>.workers.dev`. Não precisa de domínio nem do seu computador ligado.

## O que tem

| Tela | O que faz |
|---|---|
| **Resumo** | Total do mês (parcelados + fixos + avulsos), quanto cai em cada cartão, orçamentos, quem te deve e aportes do mês |
| **Gastos → Avulsos** | Lançamentos do mês, agrupados por dia, com filtro por cartão |
| **Gastos → Parcelados** | Parcela atual (9/10), quando termina, quanto falta pagar |
| **Gastos → Fixos** | Assinaturas e contas (marcar como pago, ajustar o valor só de um mês) e **orçamentos** |
| **Devedores** | Quem te deve, agrupado por pessoa; “Recebi tudo” |
| **Metas** | Saldo investido, alvo, aporte mensal com check, previsão de quando atinge a meta |
| **Ajustes** | Cartões (com dia de fechamento/vencimento), renda, link do conector do Claude, backup |

Conceitos principais:

- **Orçamento** = “descontar dos fixos”. Um fixo com valor reservado (ex.: R$ 500 de almoço). Os gastos lançados nele não somam de novo no total; só o que estourar.
- **Dividir com alguém** ao lançar um gasto: a sua parte fica nos gastos e a parte dos outros vira **devedor** (no mesmo cartão).
- **Fatura**: com o dia de fechamento do cartão cadastrado, compras feitas a partir desse dia vão automaticamente para a fatura do mês seguinte.

## Rodar localmente

```bash
npm install
cp .dev.vars.example .dev.vars   # defina APP_PASSWORD e MCP_TOKEN locais
npm run db:migrate:local
npm run db:seed:local            # opcional: dados fictícios de exemplo
npm run dev                      # http://localhost:5173
```

Para abrir no celular na mesma rede Wi-Fi: `http://<ip-do-mac>:5173`.

## Publicar na Cloudflare (grátis)

1. Crie uma conta grátis em <https://dash.cloudflare.com/sign-up> e faça login no terminal:
   ```bash
   npx wrangler login
   ```
2. Crie o banco e deixe o Wrangler gravar o ID no `wrangler.jsonc`:
   ```bash
   npx wrangler d1 create financas --binding DB --update-config
   ```
   (se ele adicionar uma segunda entrada `DB`, apague a antiga sem `database_id`.)
3. Crie as tabelas:
   ```bash
   npm run db:migrate:remote
   ```
   Para importar dados que você já tem, veja [Seus dados reais](#seus-dados-reais).
4. Defina os segredos (o terminal pede o valor; nada fica no código):
   ```bash
   npx wrangler secret put APP_PASSWORD
   openssl rand -hex 32            # gere um token e cole no próximo comando
   npx wrangler secret put MCP_TOKEN
   ```
5. Publique:
   ```bash
   npm run deploy
   ```
   O endereço aparece no final (`https://financas.<sua-conta>.workers.dev`).

Para atualizar depois: `npm run deploy`. Se criar novas migrações em `migrations/`, rode `npm run db:migrate:remote` antes.

### Instalar no celular

Abra o endereço no Safari (iPhone) ou Chrome (Android) → **Compartilhar → Adicionar à Tela de Início**. Abre em tela cheia, como um app.

## Conectar ao Claude (MCP)

O servidor MCP fica em `https://financas.<sua-conta>.workers.dev/mcp/<MCP_TOKEN>`. O link completo aparece em **Ajustes → Conectar ao Claude** (botão copiar).

**Claude (web, desktop e celular):** Configurações → Conectores → **Adicionar conector personalizado** → cole o link. Conectores adicionados na web também aparecem no app do celular.

**Claude Code:**

```bash
claude mcp add --transport http financas https://financas.<sua-conta>.workers.dev/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Exemplos do que pedir:

- “Lança 32,50 de almoço no VR” (desconta do orçamento de alimentação)
- “Gastei 298,20 no mercado no Nubank, metade é da Ana”
- “Comprei um fone de 600 em 6x no Inter”
- “A conta de luz desse mês veio 212,37”
- “Cancela o streaming a partir de dezembro”
- “O Pedro me pagou tudo”
- “Faz o aporte do mês na reserva de emergência”
- “Como estou esse mês?” / “Quanto falta do orçamento de transporte?”

Ferramentas disponíveis: `resumo_mes`, `listar_cadastros`, `lancar_despesa`, `lancar_parcelado`, `adicionar_fixo`, `ajustar_fixo`, `registrar_devedor`, `marcar_recebido`, `listar_devedores`, `listar_lancamentos`, `editar_lancamento`, `remover_lancamento`, `listar_metas`, `criar_meta`, `registrar_aporte`, `atualizar_saldo_meta`, `cadastrar_conta`.

> O link do MCP funciona como uma senha. Se vazar, troque com `npx wrangler secret put MCP_TOKEN` e atualize o conector.

## Seus dados reais

Nada pessoal vai para o git: segredos ficam em `.dev.vars` (local) e `wrangler secret` (produção), e qualquer arquivo `*.local.sql` é ignorado.

Para importar dados existentes (ex.: de uma planilha), escreva os `INSERT`s em `seed/<nome>.local.sql` seguindo o formato de [seed/example.sql](seed/example.sql) e rode:

```bash
npx wrangler d1 execute DB --local --file=seed/<nome>.local.sql    # banco local
npx wrangler d1 execute DB --remote --file=seed/<nome>.local.sql   # produção
```

## Limites do plano grátis

100 mil requisições/dia no Workers e 5 GB no D1 — muito acima do uso pessoal. Faça backups em **Ajustes → Baixar backup (JSON)** de vez em quando.

## Estrutura

```
migrations/          schema do banco (D1/SQLite)
seed/example.sql     dados fictícios para desenvolvimento (*.local.sql = dados reais, fora do git)
src/shared/          utilitários (meses, dinheiro) e tipos usados no front e no Worker
src/worker/          API (Hono), autenticação, serviços e servidor MCP
src/client/          app React (PWA): views/, forms/, componentes de UI
public/              ícones, manifest e service worker
```
