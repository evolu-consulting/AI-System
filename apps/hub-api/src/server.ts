// HUB-NFR-04 · điểm khởi động hub-api: nơi duy nhất đọc env và mở cổng (plan H1 §4, §7).
// Thứ tự: env → storage file (H2c, `HUB_ATTACH_*`) → khoá JWT công khai → DB (`HUB_DATABASE_URL`, ping) → cột Admin bắt buộc (X1, HUB-FR-95) → Orchestrator hợp lệ (HUB-BR-08) → master key (H2a) → Redis (connect + ping) → serve.
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
import type { AttachmentDeps } from "./modules/attachments/storage";
import { createLocalStorage } from "./modules/attachments/storage.local";
import { bootOrchestratorProblem } from "./modules/config/config.service";
import { missingAdminColumns } from "./modules/config/schema-check";
import { loadMasterKey, probeMasterKey } from "./modules/dify/credential.service";

function fail(step: string, err: unknown): never {
  logger.fatal(step, safeErrorFields(err));
  process.exit(1);
}

async function openDb(env: Env): Promise<Db> {
  const db = connectDb(env.HUB_DATABASE_URL);
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
  const storage = await createLocalStorage({ dir: a.dir }).catch((err) => fail("attachments", err));
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
  const redis = await openRedis(env).catch((err) => fail("redis", err));
  const stop = new AbortController();
  const app = createApp(
    { version: pkg.version, corsOrigins: env.HUB_CORS_ORIGINS },
    {
      probes: [() => pingDb(db), () => pingRedis(redis)],
      db,
      redis,
      jwtPublicKey,
      ...fromEnv,
      attachments,
      signal: stop.signal,
    },
  );
  const server = serve(env, app.fetch);

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("shutdown", { signal });
    stop.abort();
    await server.stop();
    redis.disconnect();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
