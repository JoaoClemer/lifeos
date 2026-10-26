// Segredos opcionais (não aparecem no .dev.vars de todo mundo, então não entram no worker-configuration.d.ts gerado)
interface Env {
  /** Chave das sessões (wrangler secret put SESSION_SECRET). Sem ela, usa APP_PASSWORD. */
  SESSION_SECRET?: string;
}
