// Passkeys no navegador: o aparelho cria/usa a chave (Face ID, digital, PIN) e o servidor confere.
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { api } from "../api";

export const supportsPasskeys = () => browserSupportsWebAuthn();

/** Mensagem amigável quando a pessoa cancela ou o aparelho recusa. */
export function passkeyError(e: unknown): string {
  const name = e instanceof Error ? e.name : "";
  if (name === "NotAllowedError" || name === "AbortError") return "Cancelado. Tente de novo quando quiser.";
  if (name === "InvalidStateError") return "Este aparelho já tem uma passkey desta conta.";
  return e instanceof Error ? e.message : "Não foi possível usar a passkey";
}

type Creation = { challengeId: string; options: PublicKeyCredentialCreationOptionsJSON };
type Request = { challengeId: string; options: PublicKeyCredentialRequestOptionsJSON };

export async function loginWithPasskey(): Promise<void> {
  const { challengeId, options } = await api.post<Request>("/api/auth/login/options");
  const response = await startAuthentication({ optionsJSON: options });
  await api.post("/api/auth/login/verify", { challengeId, response });
}

/** Convite (conta nova) ou recuperação (nova passkey): cadastra a passkey e já entra. */
export async function registerFromLink(token: string, name?: string): Promise<void> {
  const { challengeId, options } = await api.post<Creation>("/api/auth/invite/options", { token, name });
  const response = await startRegistration({ optionsJSON: options });
  await api.post("/api/auth/invite/verify", { token, name, challengeId, response });
}

/** Mais um aparelho para quem já está logado. */
export async function addPasskey(): Promise<void> {
  const { challengeId, options } = await api.post<Creation>("/api/me/passkeys/options");
  const response = await startRegistration({ optionsJSON: options });
  await api.post("/api/me/passkeys/verify", { challengeId, response });
}
