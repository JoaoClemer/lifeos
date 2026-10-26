// Sessão simples para uso pessoal: senha única (APP_PASSWORD) -> cookie assinado com HMAC.
// O MCP usa um token separado (MCP_TOKEN), na URL (/mcp/<token>) ou no header Authorization: Bearer.
// Devedores têm códigos próprios (DEBTOR_CODE_<NOME>) e só enxergam os próprios valores (ver fim do arquivo).

export const SESSION_COOKIE = "fin_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180; // 180 dias

const enc = new TextEncoder();

async function hmac(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Comparação em tempo constante (evita timing attacks). */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) return false;
  return crypto.subtle.timingSafeEqual(ab, bb);
}

export async function createSession(secret: string): Promise<string> {
  const issued = Date.now().toString();
  return `${issued}.${await hmac(secret, `session:${issued}`)}`;
}

export async function verifySession(secret: string | undefined, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  if (Date.now() - Number(issued) > SESSION_MAX_AGE * 1000) return false;
  return safeEqual(sig, await hmac(secret, `session:${issued}`));
}

export function checkMcpToken(expected: string | undefined, provided: string | undefined): boolean {
  if (!expected || expected.length < 16 || !provided) return false;
  return safeEqual(provided, expected);
}

// ---- Acesso de devedores (/devedor) ----
// Cada pessoa entra com o próprio código (DEBTOR_CODE_<NOME>). O cookie é separado do dono do app,
// fica restrito a /api/debtor e é assinado com o código da pessoa: trocar o código derruba as sessões dela.

export const DEBTOR_COOKIE = "fin_debtor";
export const DEBTOR_MAX_AGE = 60 * 60 * 24 * 30; // 30 dias

export async function createDebtorSession(key: string, code: string): Promise<string> {
  const issued = Date.now().toString();
  return `${key}.${issued}.${await hmac(code, `debtor:${key}:${issued}`)}`;
}

/** Chave da pessoa dona do cookie, ou null se o cookie for inválido, expirado ou de um código antigo. */
export async function verifyDebtorSession(codes: Map<string, string>, token: string | undefined): Promise<string | null> {
  const [key, issued, sig] = token?.split(".") ?? [];
  const code = key ? codes.get(key) : undefined;
  if (!code || !issued || !/^\d+$/.test(issued) || !sig) return null;
  if (Date.now() - Number(issued) > DEBTOR_MAX_AGE * 1000) return null;
  return safeEqual(sig, await hmac(code, `debtor:${key}:${issued}`)) ? key : null;
}
