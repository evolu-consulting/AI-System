// HUB-NFR-04 · H2a plan §8 · env đã kiểm → phần `AppDeps` lấy từ env (tách khỏi `server.ts` để test được, REVIEW 1 Hub #1, #10).
import type { AppDeps } from "../app";
import type { Logger } from "../lib/logger";
import { type AttachEnv, parseAttachEnv } from "../modules/attachments/attach-env.rules";
import { parseMaxConcurrentRuns } from "../modules/runs/run-limit.rules";
import type { Env } from "./env";

export type EnvAppDeps = Required<
  Pick<
    AppDeps,
    | "appEnv"
    | "instanceId"
    | "jobMaxWaitS"
    | "configPollS"
    | "difyTimeoutMaxS"
    | "maxConcurrentRuns"
  >
> &
  Pick<AppDeps, "secretMasterKey" | "internalToken" | "publicInternalUrl" | "studioDist">;

/**
 * Ánh xạ env → deps của `createApp`. Vắng `HUB_PUBLIC_INTERNAL_URL` (production) → cảnh báo một lần: MCP tắt.
 * `HUB_MAX_CONCURRENT_RUNS` sai → ném (server thoát ≠ 0); vắng → 2 (server luôn điền, H2b L1).
 */
export function envAppDeps(env: Env, log: Pick<Logger, "warn">): EnvAppDeps {
  if (env.HUB_PUBLIC_INTERNAL_URL === undefined)
    log.warn("mcp_disabled", { reason: "HUB_PUBLIC_INTERNAL_URL missing" });
  return {
    appEnv: env.APP_ENV,
    instanceId: env.HUB_INSTANCE_ID,
    jobMaxWaitS: env.HUB_JOB_MAX_WAIT_S,
    configPollS: env.HUB_CONFIG_POLL_S,
    secretMasterKey: env.SECRET_MASTER_KEY,
    internalToken: env.HUB_INTERNAL_TOKEN,
    publicInternalUrl: env.HUB_PUBLIC_INTERNAL_URL,
    difyTimeoutMaxS: env.HUB_DIFY_TIMEOUT_MAX_S,
    maxConcurrentRuns: parseMaxConcurrentRuns(env.HUB_MAX_CONCURRENT_RUNS),
    studioDist: env.HUB_STUDIO_DIST,
  };
}

/**
 * H2c · `HUB_ATTACH_*` → cấu hình storage (spec-decisions "BUILD — B1" B1-1). Có bất kỳ biến nào, hoặc `production` ⇒ kiểm
 * chặt (`parseAttachEnv` ném ⇒ server thoát ≠ 0, R04/AC-15). development/test mà vắng **cả** `HUB_ATTACH_DRIVER` lẫn
 * `HUB_ATTACH_DIR` ⇒ null + cảnh báo một lần: Hub lên không có route file (PL14) — giữ harness khoá H1/H2a/H2b spawn
 * `server.ts` không có env H2c.
 */
export function attachEnvOf(
  env: Env,
  log: Pick<Logger, "warn">,
  platform: NodeJS.Platform = process.platform,
): AttachEnv | null {
  const none = env.HUB_ATTACH_DRIVER === undefined && env.HUB_ATTACH_DIR === undefined;
  if (none && env.APP_ENV !== "production") {
    log.warn("attachments_disabled", { reason: "HUB_ATTACH_DRIVER/HUB_ATTACH_DIR missing" });
    return null;
  }
  return parseAttachEnv(env, platform);
}
