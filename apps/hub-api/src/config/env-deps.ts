// HUB-NFR-04 · H2a plan §8 · env đã kiểm → phần `AppDeps` lấy từ env (tách khỏi `server.ts` để test được, REVIEW 1 Hub #1, #10).
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppDeps } from "../app";
import type { Logger } from "../lib/logger";
import { type AttachEnv, parseAttachEnv } from "../modules/attachments/attach-env.rules";
import type { LiveEnv } from "../modules/notify/notify.mount";
import { parseMaxConcurrentRuns } from "../modules/runs/run-limit.rules";
import { type Env, khConfigOf } from "./env";

export type EnvAppDeps = Required<
  Pick<
    AppDeps,
    | "appEnv"
    | "instanceId"
    | "jobMaxWaitS"
    | "configPollS"
    | "difyTimeoutMaxS"
    | "maxConcurrentRuns"
    | "kh"
  >
> &
  Pick<
    AppDeps,
    | "secretMasterKey"
    | "internalToken"
    | "adminApiUrl"
    | "publicInternalUrl"
    | "studioDist"
    | "processEngine"
    | "frozenModules"
    | "processRoutes"
    | "fastRoute"
    | "notify"
    | "ops"
  >;

/** N3 live (ADR-0027): SMTP/VAPID nền tảng một bộ từ env; bí mật chỉ từ env hoặc kho secret, không có giá trị cố định trong code. */
function liveEnvOf(env: Env): LiveEnv {
  return {
    smtp: {
      host: env.HUB_SMTP_HOST,
      port: env.HUB_SMTP_PORT,
      secure: env.HUB_SMTP_SECURE,
      user: env.HUB_SMTP_USER,
      from: env.HUB_SMTP_FROM,
    },
    vapid: env.HUB_VAPID_PUBLIC_KEY
      ? { publicKey: env.HUB_VAPID_PUBLIC_KEY, subject: env.HUB_VAPID_SUBJECT }
      : null,
    ...(env.SMTP_PASSWORD ? { smtpPassword: env.SMTP_PASSWORD } : {}),
    ...(env.VAPID_PRIVATE_KEY ? { vapidPrivateKey: env.VAPID_PRIVATE_KEY } : {}),
  };
}

/**
 * Ánh xạ env → deps của `createApp`. Vắng `HUB_PUBLIC_INTERNAL_URL` (production) → cảnh báo một lần: MCP tắt.
 * `HUB_MAX_CONCURRENT_RUNS` sai → ném (server thoát ≠ 0); vắng → 2 (server luôn điền, H2b L1).
 */
export function envAppDeps(env: Env, log: Pick<Logger, "warn">): EnvAppDeps {
  // N3 D-03: `fake` ghi "đã gửi" mà không gửi thật ⇒ cấm ở production.
  if (env.HUB_NOTIFY_MODE === "fake" && env.APP_ENV === "production")
    throw new Error(
      "HUB_NOTIFY_MODE=fake không được dùng ở production (bản gửi giả đánh dấu đã gửi)",
    );
  if (env.HUB_PUBLIC_INTERNAL_URL === undefined)
    log.warn("mcp_disabled", { reason: "HUB_PUBLIC_INTERNAL_URL missing" });
  return {
    appEnv: env.APP_ENV,
    instanceId: env.HUB_INSTANCE_ID,
    jobMaxWaitS: env.HUB_JOB_MAX_WAIT_S,
    configPollS: env.HUB_CONFIG_POLL_S,
    secretMasterKey: env.SECRET_MASTER_KEY,
    internalToken: env.HUB_INTERNAL_TOKEN,
    adminApiUrl: env.HUB_ADMIN_API_URL,
    publicInternalUrl: env.HUB_PUBLIC_INTERNAL_URL,
    difyTimeoutMaxS: env.HUB_DIFY_TIMEOUT_MAX_S,
    maxConcurrentRuns: parseMaxConcurrentRuns(env.HUB_MAX_CONCURRENT_RUNS),
    studioDist: env.HUB_STUDIO_DIST,
    processEngine: env.HUB_PROCESS_ENGINE === "on",
    frozenModules: env.HUB_FROZEN_MODULES === "on",
    ...(env.HUB_PROCESS_ROUTES ? { processRoutes: env.HUB_PROCESS_ROUTES } : {}), // CR-103
    fastRoute: env.HUB_FAST_ROUTE === "on",
    notify: {
      mode: env.HUB_NOTIFY_MODE,
      worker: env.HUB_NOTIFY_MODE !== "off",
      baseUrl: env.HUB_NOTIFY_BASE_URL,
      vapidPublicKey: env.HUB_VAPID_PUBLIC_KEY ?? null,
      ...(env.HUB_NOTIFY_MODE === "live" ? { live: liveEnvOf(env) } : {}),
    },
    kh: khConfigOf(env),
    ops: {
      watch: env.HUB_OPS_WATCH ? env.HUB_OPS_WATCH === "on" : env.APP_ENV !== "test",
    },
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
  // `HUB_ATTACH_DIR` trống ở dev/test ⇒ thư mục tạm cố định của OS (production vẫn bắt buộc tuyệt đối).
  return parseAttachEnv(env, platform, join(tmpdir(), "ai-hub-attachments"));
}
