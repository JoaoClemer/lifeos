import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { personKey } from "../shared/receivables";
import { createDebtorSession, DEBTOR_COOKIE, DEBTOR_MAX_AGE, safeEqual, verifyDebtorSession } from "./auth";
import { makeCtx } from "./lib";
import { debtorCodes, debtorStatement, peopleWithAccess } from "./services/debtorAccess";

// API pública da página /devedor. Não usa a sessão do dono do app: cada pessoa entra com o próprio código
// e só recebe os valores dela.
export const debtorApi = new Hono<{ Bindings: Env }>();

const COOKIE_PATH = "/api/debtor";
const LoginInput = z.object({ person: z.string().trim().min(1), code: z.string().trim().min(1) });

/** Nomes para a pessoa escolher o dela (só quem tem código configurado). */
debtorApi.get("/people", async (c) => {
  const people = await peopleWithAccess(makeCtx(c.env), debtorCodes(c.env));
  return c.json(people.map((p) => p.name));
});

debtorApi.post("/login", async (c) => {
  const { person, code } = LoginInput.parse(await c.req.json());
  const key = personKey(person);
  const expected = debtorCodes(c.env).get(key);
  if (!expected || !safeEqual(code, expected)) {
    await new Promise((r) => setTimeout(r, 800)); // dificulta força bruta
    return c.json({ error: "Nome ou código incorreto" }, 401);
  }
  setCookie(c, DEBTOR_COOKIE, await createDebtorSession(key, expected), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: COOKIE_PATH,
    maxAge: DEBTOR_MAX_AGE,
  });
  return c.json({ ok: true });
});

debtorApi.post("/logout", (c) => {
  deleteCookie(c, DEBTOR_COOKIE, { path: COOKIE_PATH });
  return c.json({ ok: true });
});

debtorApi.get("/statement", async (c) => {
  const codes = debtorCodes(c.env);
  const key = await verifyDebtorSession(codes, getCookie(c, DEBTOR_COOKIE));
  if (!key) return c.json({ error: "Não autenticado" }, 401);
  const ctx = makeCtx(c.env);
  const person = (await peopleWithAccess(ctx, codes)).find((p) => p.key === key)!;
  return c.json(await debtorStatement(ctx, key, person.name));
});
