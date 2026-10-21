// HUB-NFR-04 · phụ thuộc của `createApp` (tách khỏi `app.ts` để file ≤ 400 dòng, chat-fast). Chỉ kiểu.
import type { KhConfig } from "./config/env";
import type { Db } from "./lib/db";
import type { HubAuditWriter } from "./lib/hub-audit";
import type { Redis } from "./lib/redis";
import type { AttachmentDeps } from "./modules/attachments/storage";
import type { DlcEngine } from "./modules/dlc/dlc.engine";
import type { NotifyDeps } from "./modules/notify/notify.mount";
import type { PacksDeps } from "./modules/packs/packs.mount";
import type { ProcessSeams } from "./modules/processes/processes.mount";
import type { RunDriver } from "./modules/runs/runs.service";
import type { SecretKey } from "./modules/secrets/secrets.crypto";

/** Kiểm phụ thuộc cho /health; ném lỗi = không sẵn sàng → 503. Vắng (test khung) → luôn ok. */
export type HealthProbe = () => Promise<void>;
/**
 * Phụ thuộc của app (seam test ↔ hub-api: spec-decisions QW-A1, QW-A2). Mọi trường tuỳ chọn; vắng `db` ⇒ không có vòng nền
 * (test khung). Có `db` ⇒ vòng nền tự chạy ngay trong `createApp` và dừng khi `signal` abort.
 */
export type AppDeps = {
  probes?: HealthProbe[];
  db?: Db;
  redis?: Redis;
  jwtPublicKey?: CryptoKey;
  appEnv?: "development" | "test" | "production";
  /** = `HUB_INSTANCE_ID` (chủ run/lease). */
  instanceId?: string;
  /** = `HUB_JOB_MAX_WAIT_S`. */
  jobMaxWaitS?: number;
  /** = `HUB_CONFIG_POLL_S` (mặc định 60). */
  configPollS?: number;
  signal?: AbortSignal;
  /** Vòng chạy run. Vắng → vòng Orchestrator (B8) qua `JobAgentRunner` (B7). */
  runDriver?: RunDriver;
  /** H2a · = `SECRET_MASTER_KEY` (base64 32 byte, chung Admin); nạp bằng `loadMasterKey` (dify/credential.service). */
  secretMasterKey?: string;
  /** H4b-1 D11 · = `HUB_SECRETS_KEY` đã kiểm (server điền). Vắng ⇒ POST/PUT có `value` 409 `NOT_CONFIGURED` (test cũ). */
  hubSecretsKey?: SecretKey | null;
  /** H4b-2 plan §4 · `fetch` cho "Kiểm tra key" + `sleep` chờ probe subscription (test tiêm; vắng ⇒ global/`Bun.sleep`). */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** H2a · = `HUB_INTERNAL_TOKEN` (vắng → `/internal/test-run` 503). */
  internalToken?: string;
  /** H2a · = `HUB_PUBLIC_INTERNAL_URL` (dựng `mcp.url` = `<url>/mcp`). */
  publicInternalUrl?: string;
  /** H2a · = `HUB_DIFY_TIMEOUT_MAX_S` (mặc định 300). */
  difyTimeoutMaxS?: number;
  /** H2b · = `HUB_MAX_CONCURRENT_RUNS` (server điền, mặc định 2). Vắng ⇒ không giới hạn (L1: test khoá H1/H2a). */
  maxConcurrentRuns?: number;
  /** chat-fast · = `HUB_FAST_ROUTE==="on"`: tin không tag mà AU đúng một agent ⇒ run `direct` (bỏ job Orchestrator). Vắng ⇒ tắt. */
  fastRoute?: boolean;
  /** H2c · storage + hạn mức + sweeper (`HUB_ATTACH_*`, server điền). Vắng ⇒ không mount route file (PL14). */
  attachments?: AttachmentDeps;
  /** H3b · ghi `hub.audit_log` (grant/revoke/view_trace). Vắng ⇒ `dbHubAudit`; test tiêm lỗi giữa transaction (P12). */
  hubAudit?: HubAuditWriter;
  /** X2a · nhịp `: ping` của `/me/stream` (ms). Vắng ⇒ 15000; test truyền 500. */
  pingMs?: number;
  studioDist?: string; // H4a · = `HUB_STUDIO_DIST` (dist Studio; vắng ⇒ `/studio` 404, P12).
  /** P-a D15 · = `HUB_PROCESS_ENGINE==="on"`; vắng ⇒ false (không mount route quy trình, `!` là chữ thường). */
  processEngine?: boolean;
  /**
   * F1 (CR-095) · module đóng băng (docs/platform/modules.md): `false` ⇒ KHÔNG mount route công khai của quy trình, phòng (`/rooms`), nguồn,
   * KH (`/studio/api/kh*`) và `/dlc`; engine quy trình vẫn chạy nội bộ theo `processEngine` (gói hợp đồng cần). Vắng ⇒ bật (test in-process
   * giữ nguyên); `server.ts` luôn điền từ `HUB_FROZEN_MODULES` (mặc định off).
   */
  frozenModules?: boolean;
  /** P-b C13 · = `HUB_SOURCE_CHECK_TIMEOUT_MS`; "Kiểm tra kết nối" chờ Runtime resolve (mặc định 60000). */
  sourceCheckTimeoutMs?: number;
  /** K1 G1 · = `khConfigOf(env)` (server điền); vắng ⇒ không origin KH nào được phép. */
  kh?: KhConfig;
  /** DLC-R11 · engine AI SDLC (`HUB_DLC_*`, server dựng). Vắng ⇒ `/dlc/*` trả `engine: not_configured`. */
  dlc?: DlcEngine;
  /** N1 T5c · module gói (`modules/packs/packs.mount.ts`): `pkdemo` vắng ⇒ chỉ mở khi `appEnv` là development/test. */
  packs?: PacksDeps;
  /** N3 · cổng thông báo (`modules/notify/notify.mount.ts`): route chuông luôn mở; worker chỉ khi `worker` và `mode` ≠ off. */
  notify?: NotifyDeps;
} & ProcessSeams;
