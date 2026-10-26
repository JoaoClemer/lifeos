import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach } from "vitest";
import { assertNoOwnerViolations, installOwnerGuard } from "./ownerGuard";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Toda consulta do Worker precisa filtrar pelo dono (ver ownerGuard.ts)
installOwnerGuard(env.DB);
afterEach(assertNoOwnerViolations);
