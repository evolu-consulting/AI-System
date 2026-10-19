// HUB-NFR-04 · điểm khởi động hub-api: nơi duy nhất đọc env và mở cổng (plan H1 §4, §7).
// Thứ tự: env → storage file (H2c, `HUB_ATTACH_*`) → khoá JWT công khai → DB (`HUB_DATABASE_URL`, ping) → cột Admin bắt buộc (X1, HUB-FR-95) → Orchestrator hợp lệ (HUB-BR-08) → master key (H2a) → khoá secrets Hub (H4b-1) → Redis (connect + ping) → serve.
// Lỗi bước nào → log `fatal` + exit 1.
import { SSE_HEARTBEAT_S } from "@ai/contracts/chat";
import pkg from "../package.json";
import { createApp } from "./app";
import { type Env, loadEnv } from "./config/env";
import { attachEnvOf, envAppDeps } from "./config/env-deps";
import { connectDb, type Db, pingDb } from "./lib/db";
import { safeErrorFields } from "./lib/errors";
import { importJwtPublicKey } from "./lib/jwt";
import { logger, setMinLevel } from "./lib/logger";
import { createRedis, pingRedis, type Redis } from "./lib/redis";
import { MAX_REQUEST_BODY_BYTES } from "./lib/unread-body";
import { envFileboxToken } from "./modules/attachments/filebox-token";
import type { AttachmentDeps } from "./modules/attachments/storage";
import { createFileboxStorage } from "./modules/attachments/storage.filebox";
import { createLocalStorage } from "./modules/attachments/storage.local";
import { bootOrchestratorProblem } from "./modules/config/config.service";
import { missingAdminColumns } from "./modules/config/schema-check";
import { loadMasterKey, probeMasterKey } from "./modules/dify/credential.service";
import { DlcEngine } from "./modules/dlc/dlc.engine";
import { checkHubSecretsKey, type SecretKey } from "./modules/secrets/secrets.crypto";

/** DLC-R11 · `HUB_DLC_URL` vắng ⇒ không có engine (`/dlc/*` trả `not_configured`). */
function dlcEngineOf(env: Env): DlcEngine | undefined {
  if (!env.HUB_DLC_URL) return undefined;
  return new DlcEngine({
    url: env.HUB_DLC_URL,
    tokenUrl: env.HUB_DLC_TOKEN_URL,
    clientId: env.HUB_DLC_CLIENT_ID,
    clientSecret: env.HUB_DLC_CLIENT_SECRET,
    caFile: env.HUB_DLC_CA_FILE,
  });
}

function fail(step: string, err: unknown): never {
  logger.fatal(step, safeErrorFields(err));
  process.exit(1);
}

async function openDb(env: Env): Promise<Db> {
  const db = connectDb(env.HUB_DATABASE_URL, 10, { spread: true });
  try {
    await pingDb(db);
    return db;
  } catch (err) {
    await db.close();
    throw err;
  }
}

async function openRedis(env: Env): Promise<Redis> {
  const redis = createRedis(env.REDIS_URL);
  try {
    await redis.connect();
    await pingRedis(redis);
    return redis;
  } catch (err) {
    redis.disconnect();
    throw err;
  }
}

function readEnv(): Env {
  try {
    const env = loadEnv(process.env);
    setMinLevel(env.LOG_LEVEL);
    return env;
  } catch (err) {
    fail("env", err);
  }
}

/** Phần `AppDeps` từ env; giá trị sai (vd. `HUB_MAX_CONCURRENT_RUNS`, H2b R16) → fatal trước khi mở DB. */
function readEnvDeps(env: Env): ReturnType<typeof envAppDeps> {
  try {
    return envAppDeps(env, logger);
  } catch (err) {
    fail("env", err);
  }
}

/**
 * H2c R04 · AC-15: `HUB_ATTACH_*` sai hoặc thư mục không tạo/ghi được → fatal (log không chứa giá trị env/đường dẫn).
 * Vắng cả driver lẫn dir ngoài production → không có storage (route file không mount, PL14).
 */
async function openAttachments(env: Env): Promise<AttachmentDeps | undefined> {
  let a: ReturnType<typeof attachEnvOf>;
  try {
    a = attachEnvOf(env, logger);
  } catch (err) {
    fail("env", err);
  }
  if (!a) return undefined;
  if (a.driver === "local") {
    const storage = await createLocalStorage({ dir: a.dir }).catch((err) =>
      fail("attachments", err),
    );
    return { storage, tenantMaxBytes: a.tenantMaxBytes, sweepS: a.sweepS };
  }
  // FB1 (HUB-FR-138, core-only): kho FileBox; Bearer từ ENV `FILEBOX_TOKEN` (fail-closed khi vắng). Không dispatcher.
  const storage = createFileboxStorage({
    url: a.url,
    org: a.org,
    token: envFileboxToken(env.FILEBOX_TOKEN),
    ...(a.caPath ? { caPath: a.caPath } : {}),
    timeoutMs: a.timeoutMs,
    log: logger,
  });
  return { storage, tenantMaxBytes: a.tenantMaxBytes, sweepS: a.sweepS };
}

/** HUB-FR-95 · X1-AC15: thiếu cột Admin bắt buộc (`admin.workflows.side_effect`) → exit 1 trước khi mở cổng. */
async function assertAdminSchema(db: Db): Promise<void> {
  const columns = await missingAdminColumns(db).catch((err) => fail("admin-schema", err));
  if (columns.length === 0) return;
  logger.error("admin-schema-missing", { columns, hint: "bun run db:migrate" });
  await db.close();
  process.exit(1);
}

/** HUB-BR-08: Orchestrator thiếu/tắt → exit 1 trước khi mở cổng. */
async function assertOrchestrator(db: Db): Promise<void> {
  const problem = await bootOrchestratorProblem(db).catch((err) => fail("orchestrator", err));
  if (!problem) return;
  logger.fatal("orchestrator-invalid", { reason: problem });
  await db.close();
  process.exit(1);
}

/**
 * H2a plan §8: `SECRET_MASTER_KEY` sai định dạng/tự kiểm hỏng → fatal. Khớp khoá Admin chỉ dò (giải thử một secret thật) và
 * cảnh báo — một secret hỏng không được làm sập Hub. Vắng → cảnh báo, mọi lời gọi Dify `NOT_CONFIGURED`.
 */
async function checkMasterKey(env: Env, db: Db): Promise<void> {
  let key: ReturnType<typeof loadMasterKey> = null;
  try {
    key = loadMasterKey(env.SECRET_MASTER_KEY);
  } catch (err) {
    fail("secret_master_key", err);
  }
  if (key) await probeMasterKey(db, key, logger).catch(() => "none");
  else logger.warn("secret_master_key_missing");
}

/**
 * H4b-1 plan §4 · AC-H4b1-06: `HUB_SECRETS_KEY` thiếu/sai/trùng `SECRET_MASTER_KEY`/tự kiểm hỏng ⇒ fatal
 * `hub_secrets_key_invalid` chỉ kèm `reason` (không bao giờ giá trị khoá), exit 1 trước khi mở cổng.
 */
async function checkHubKey(env: Env, db: Db): Promise<SecretKey> {
  const r = checkHubSecretsKey(env.HUB_SECRETS_KEY, env.SECRET_MASTER_KEY);
  if (r.ok) return r.key;
  logger.fatal("hub_secrets_key_invalid", { reason: r.reason });
  await db.close();
  process.exit(1);
}

/**
 * SSE: Bun mặc định đóng kết nối im > 10 s, trước nhịp `: ping` (SSE_HEARTBEAT_S) → đặt gấp đôi nhịp ping.
 * H2c P4: thân request ≤ 32 MiB chặn ngoài (mặc định Bun 128 MiB); bộ đếm trong `AttachmentStorage.stage` là chốt.
 */
function serve(
  env: Env,
  fetch: (req: Request, server: Bun.Server<undefined>) => Response | Promise<Response>,
) {
  const server = Bun.serve({
    port: env.HUB_PORT,
    fetch,
    idleTimeout: SSE_HEARTBEAT_S * 2,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  });
  logger.info("listening", {
    port: server.port,
    app_env: env.APP_ENV,
    instance_id: env.HUB_INSTANCE_ID,
    version: pkg.version,
  });
  return server;
}

async function main(): Promise<void> {
  const env = readEnv();
  const fromEnv = readEnvDeps(env);
  const attachments = await openAttachments(env);
  const jwtPublicKey = await importJwtPublicKey(env.JWT_PUBLIC_KEY).catch((err) =>
    fail("jwt", err),
  );
  const db = await openDb(env).catch((err) => fail("db", err));
  await assertAdminSchema(db);
  await assertOrchestrator(db);
  await checkMasterKey(env, db);
  const hubSecretsKey = await checkHubKey(env, db);
  const redis = await openRedis(env).catch((err) => fail("redis", err));
  const stop = new AbortController();
  // TECH-DEBT #201 · tắt Hub: chờ việc stage-driver/tool-driver đang dở (`handles.settled()`, tín hiệu) TRƯỚC `db.close()`.
  let processes: { settled(): Promise<void> } | null = null;
  const app = createApp(
    { version: pkg.version, corsOrigins: env.HUB_CORS_ORIGINS },
    {
      probes: [() => pingDb(db), () => pingRedis(redis)],
      db,
      redis,
      jwtPublicKey,
      ...fromEnv,
      attachments,
      hubSecretsKey,
      dlc: dlcEngineOf(env),
      // R1 · pool riêng của module tri thức (đóng theo `signal`)
      packs: { knowledgeDsn: env.KNOWLEDGE_DATABASE_URL ?? env.HUB_DATABASE_URL },
      signal: stop.signal,
      onProcessHandles: (h) => {
        processes = h;
      },
    },
  );
  const server = serve(env, app.fetch);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutdown", { signal });
    stop.abort();
    await server.stop();
    await processes?.settled();
    redis.disconnect();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
