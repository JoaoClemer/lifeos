// Pessoas, login e acessos (usados pelo Worker e pelo app).

export type Role = "admin" | "member";

/** Quem está usando o app. */
export interface Me {
  id: number;
  name: string | null;
  role: Role;
  /** Fuso escolhido pela pessoa (null = padrão do app). */
  timezone: string | null;
  created_at: string;
}

export interface PasskeyInfo {
  id: string;
  device: string | null;
  backed_up: boolean;
  created_at: string;
  last_used_at: string | null;
}

/** Conector do Claude de uma pessoa (o token em si só aparece uma vez, ao criar). */
export interface McpTokenInfo {
  id: number;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

/** Pessoa na lista do admin. */
export interface AdminUser {
  id: number;
  name: string | null;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  disabled_at: string | null;
  passkeys: number;
  invited_by_name: string | null;
}

/** Convite ou link de recuperação ainda não usado. */
export interface PendingInvite {
  id: number;
  kind: "invite" | "recovery";
  name: string | null;
  user_id: number | null;
  expires_at: string;
  created_at: string;
}

/** Link gerado (o token só existe nele). */
export interface CreatedLink {
  url: string;
  expires_at: string;
}

/** O que a página do convite mostra antes de cadastrar a passkey. */
export interface InviteDetails {
  kind: "invite" | "recovery";
  /** Convite: nome sugerido. Recuperação: nome da pessoa. */
  name: string | null;
  invited_by: string | null;
  expires_at: string;
}

/** Nome do aparelho a partir do User-Agent, só para a pessoa reconhecer a passkey na lista. */
export function deviceFromUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  return [os, browser].filter(Boolean).join(" · ") || null;
}
