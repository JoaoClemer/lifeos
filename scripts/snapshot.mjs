// Retrato das respostas da API e do MCP, para comparar antes e depois de uma mudança (processo de release).
//
// 1. Carregue no banco local uma cópia da produção e rode `npm run dev`.
// 2. Com o código atual:      npm run snapshot -- antes
// 3. Com o código novo:       npm run snapshot -- depois
// 4. Compare:                 diff -r backups/snapshots/antes backups/snapshots/depois
//
// Rode os dois no mesmo dia: "hoje" muda o que é pendente, vencido e o mês atual.
// Os arquivos ficam em backups/snapshots/ (fora do git), porque contêm dados pessoais.
// Usa APP_PASSWORD e MCP_TOKEN do .dev.vars. Outro endereço: BASE_URL=http://... npm run snapshot -- <rótulo>

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const label = process.argv[2];
if (!label || !/^[\w.-]+$/.test(label)) {
  console.error("Uso: npm run snapshot -- <rótulo>   (ex.: antes, depois)");
  process.exit(1);
}
const base = process.env.BASE_URL ?? "http://localhost:5173";
const outDir = join("backups", "snapshots", label);

const vars = Object.fromEntries(
  (await readFile(".dev.vars", "utf8"))
    .split("\n")
    .map((line) => line.match(/^\s*([A-Z_]+)\s*=\s*(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2].trim()]),
);

const login = await fetch(`${base}/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: vars.APP_PASSWORD }),
});
if (!login.ok) throw new Error(`Login falhou (${login.status}). O servidor está rodando em ${base}?`);
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

async function api(path) {
  const res = await fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

let rpcId = 0;
async function mcp(method, params = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${vars.MCP_TOKEN}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  if (!res.ok) throw new Error(`MCP ${method}: ${res.status}`);
  return (await res.json()).result;
}
const tool = async (name, args = {}) => (await mcp("tools/call", { name, arguments: args })).content.map((c) => c.text).join("\n");

const addMonths = (month, n) => {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
};

// /api/summary informa "hoje" também nas versões anteriores do app (o /api/me só passou a informar depois)
const { today } = await api("/api/summary");
const current = today.slice(0, 7);
const months = Array.from({ length: 7 }, (_, i) => addMonths(current, i - 3));

const files = {
  "api/settings.json": await api("/api/settings"),
  "api/accounts.json": await api("/api/accounts?all=1"),
  "api/people.json": await api("/api/people"),
  "api/receivables.json": await api("/api/receivables?status=all"),
  "api/installments-all.json": await api(`/api/installments?month=${current}&all=1`),
  "api/recurring-all.json": await api(`/api/recurring?month=${current}&all=1`),
  "api/goals-all.json": await api(`/api/goals?month=${current}&all=1`),
  "mcp/tools-list.json": await mcp("tools/list"),
  "mcp/listar_cadastros.txt": await tool("listar_cadastros"),
  "mcp/listar_devedores.txt": await tool("listar_devedores", { incluir_recebidos: true }),
};
for (const m of months) {
  for (const what of ["summary", "expenses", "installments", "recurring", "incomes", "goals"]) {
    files[`api/${what}-${m}.json`] = await api(`/api/${what}?month=${m}`);
  }
  files[`mcp/resumo_mes-${m}.txt`] = await tool("resumo_mes", { mes: m });
  files[`mcp/listar_lancamentos-${m}.txt`] = await tool("listar_lancamentos", { mes: m });
  files[`mcp/listar_metas-${m}.txt`] = await tool("listar_metas", { mes: m });
}

await rm(outDir, { recursive: true, force: true });
for (const [name, content] of Object.entries(files)) {
  const path = join(outDir, name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, typeof content === "string" ? `${content}\n` : `${JSON.stringify(content, null, 2)}\n`);
}
console.log(`${Object.keys(files).length} arquivos em ${outDir} (hoje: ${today}, meses ${months[0]} a ${months.at(-1)})`);
