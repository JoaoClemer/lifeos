import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Os testes rodam dentro do runtime do Workers (Miniflare), com um D1 local criado a partir das migrations reais.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Valores de teste (os reais ficam em .dev.vars e wrangler secret)
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_PASSWORD: "senha-de-teste",
            MCP_TOKEN: "token-de-teste-0123456789",
            // Códigos de acesso da página /devedor (o de CURTO é curto demais e deve ser ignorado)
            DEBTOR_CODE_ANA: "codigo-da-ana",
            DEBTOR_CODE_PEDRO: "codigo-do-pedro",
            DEBTOR_CODE_MARIA_CLARA: "codigo-da-maria",
            DEBTOR_CODE_CURTO: "123",
          },
        },
      }),
    ],
    test: {
      include: ["test/**/*.test.ts"],
      setupFiles: ["./test/setup.ts"],
    },
  };
});
