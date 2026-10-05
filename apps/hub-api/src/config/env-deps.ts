// HUB-NFR-04 · H2a plan §8 · env đã kiểm → phần `AppDeps` lấy từ env (tách khỏi `server.ts` để test được, REVIEW 1 Hub #1, #10).
import type { AppDeps } from "../app";
import type { Logger } from "../lib/logger";
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
  Pick<AppDeps, "secretMasterKey" | "internalToken" | "publicInternalUrl">;

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
  };
}
