// HUB-FR-131 · HUB-FR-132 · plan K1 §3.2–§3.3, §11 G1 · mount module KH: client + cache project MỘT instance cho cả process
// (`KhRuntime`, T5e/T5f dùng lại), route Studio `/studio/api/kh/connections*` (sau `requirePlatformAdmin`). `cfg` = một nguồn
// cho `khUrlPolicy` (lưu + mỗi lời gọi), `KhClient` và `GET C {allowed_origins, timeout_ms}`.
import type { Env, Hono } from "hono";
import type { KhConfig } from "../../config/env";
import type { Db } from "../../lib/db";
import type { HubAuditWriter } from "../../lib/hub-audit";
import type { Logger } from "../../lib/logger";
import type { SecretKey } from "../secrets/secrets.crypto";
import { HubSecretReader } from "../secrets/secrets.use";
import { KhAgentService } from "./kh.agent.service";
import { KhCheckService } from "./kh.check.service";
import { KhClient, KhProjectsCache } from "./kh.client";
import { khStudioRoutes } from "./kh.routes";
import { KhStudioService } from "./kh.studio.service";

/** `AppDeps.kh` vắng (test cũ) ⇒ không origin nào được phép (không lưu/gọi được KH). */
export const KH_CONFIG_NONE: KhConfig = { allowedOrigins: [], timeoutMs: 5000 };

export type KhRuntime = {
  cfg: KhConfig;
  dev: boolean;
  client: KhClient;
  projects: KhProjectsCache;
};

export type KhRuntimeDeps = {
  db: Db;
  key: SecretKey | null;
  kh?: KhConfig;
  appEnv?: "development" | "test" | "production";
  log: Pick<Logger, "warn">;
};

export function khRuntime(d: KhRuntimeDeps): KhRuntime {
  const cfg = d.kh ?? KH_CONFIG_NONE;
  // RV1 #4 · fail-closed: chỉ development/test là dev (vắng `appEnv` ⇒ chế độ production).
  const dev = d.appEnv === "development" || d.appEnv === "test";
  const secrets = new HubSecretReader({ db: d.db, key: d.key, log: d.log });
  const client = new KhClient({ secrets, cfg, dev });
  return { cfg, dev, client, projects: new KhProjectsCache(client) };
}

export function mountKh<E extends Env>(
  app: Hono<E>,
  d: { db: Db; audit: HubAuditWriter; studioBase: string; rt: KhRuntime },
): void {
  const { cfg, dev, client } = d.rt;
  const studio = new KhStudioService({ db: d.db, audit: d.audit, cfg, dev });
  const checker = new KhCheckService({ db: d.db, audit: d.audit, client, cfg, dev });
  const agents = new KhAgentService({ db: d.db, audit: d.audit });
  app.route(d.studioBase, khStudioRoutes(studio, checker, agents));
}
