// Sessões: cookie assinado com HMAC dizendo quem é a pessoa e a versão das sessões dela (aumentar a versão derruba todas).
// Entra-se com passkey (modules/users/passkeys.ts) ou, só o dono, com a senha do app (APP_PASSWORD).
// O MCP usa tokens por pessoa (tabela mcp_tokens) ou, do dono, o MCP_TOKEN; na URL (/mcp/<token>) ou no header Authorization: Bearer.
// Devedores têm códigos próprios (DEBTOR_CODE_<NOME>) e só enxergam os próprios valores (ver fim do arquivo).
import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { OWNER_USER_ID } from "./lib";

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

/** Sessão do formato antigo (só a senha do app, antes das contas por pessoa). Ainda aceita: é do dono. */
async function verifyLegacySession(secret: string | undefined, token: string | undefined): Promise<boolean> {
  if (!secret || !token) return false;
  const [issued, sig] = token.split(".");
  if (!issued || !sig) return false;
  if (Date.now() - Number(issued) > SESSION_MAX_AGE * 1000) return false;
  return safeEqual(sig, await hmac(secret, `session:${issued}`));
}

/** Chave das sessões: SESSION_SECRET ou, sem ela, a senha do app. */
export function sessionKey(env: Env): string | null {
  return env.SESSION_SECRET || env.APP_PASSWORD || null;
}

export async function createUserSession(key: string, userId: number, version: number): Promise<string> {
  const issued = Date.now().toString();
  return `u.${userId}.${version}.${issued}.${await hmac(key, `user:${userId}:${version}:${issued}`)}`;
}

/** Quem a sessão diz ser. `version` null: sessão antiga do dono (vale enquanto a versão dele for 0). */
export interface SessionClaim {
  userId: number;
  version: number | null;
}

export async function readSession(env: Env, token: string | undefined): Promise<SessionClaim | null> {
  if (!token) return null;
  if (token.startsWith("u.")) {
    const key = sessionKey(env);
    const [, uid, ver, issued, sig] = token.split(".");
    if (!key || !sig || ![uid, ver, issued].every((p) => p && /^\d+$/.test(p))) return null;
    if (Date.now() - Number(issued) > SESSION_MAX_AGE * 1000) return null;
    if (!safeEqual(sig, await hmac(key, `user:${uid}:${ver}:${issued}`))) return null;
    return { userId: Number(uid), version: Number(ver) };
  }
  return (await verifyLegacySession(env.APP_PASSWORD, token)) ? { userId: OWNER_USER_ID, version: null } : null;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

/** Token aleatório (base64url), para links de convite e conectores do Claude. */
export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function base64url(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Tokens ficam no banco só como SHA-256. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Atraso em tentativas que falham (dificulta força bruta). */
export const failureDelay = () => new Promise((r) => setTimeout(r, 800));

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
