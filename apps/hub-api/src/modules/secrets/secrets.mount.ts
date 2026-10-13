// HUB-FR-68 · HUB-FR-69 · plan H4b-1 §1, D11 · mount module secrets: Studio `/studio/api/secrets*` (gắn dưới `studioBase`,
// sau `requirePlatformAdmin` của app.h4a.ts) + tenant `/admin/source-credentials*` (JWT ở gốc qua
// `SECRETS_PROTECTED_PREFIXES` trong app.ts). Một service chung; `key` vắng ⇒ POST/PUT 409 `NOT_CONFIGURED` (D11).
import type { Env, Hono } from "hono";
import type { Db } from "../../lib/db";
import type { HubAuditWriter } from "../../lib/hub-audit";
import type { SecretKey } from "./secrets.crypto";
import { SOURCE_CREDENTIALS, secretStudioRoutes, sourceCredentialRoutes } from "./secrets.routes";
import { SecretsService } from "./secrets.service";

/** Gốc route tenant cần JWT (app.ts gắn `requireAuth`). `/studio/api` đã có sẵn trong PROTECTED_PREFIXES. */
export const SECRETS_PROTECTED_PREFIXES = [SOURCE_CREDENTIALS] as const;

export type SecretsMountDeps = {
  db: Db;
  audit: HubAuditWriter;
  key: SecretKey | null;
  studioBase: string;
};

export function mountSecrets<E extends Env>(app: Hono<E>, d: SecretsMountDeps): void {
  const svc = new SecretsService({ db: d.db, audit: d.audit, key: d.key });
  app.route(d.studioBase, secretStudioRoutes(svc));
  app.route("/", sourceCredentialRoutes(svc));
}
