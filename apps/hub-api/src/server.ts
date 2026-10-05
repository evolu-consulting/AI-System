// HUB-NFR-04 · điểm khởi động hub-api: nơi duy nhất đọc env và mở cổng (plan H1 §4, §7).
// Thứ tự: env → khoá JWT công khai → DB (`HUB_DATABASE_URL`, ping) → Orchestrator hợp lệ (HUB-BR-08) → master key (H2a) → Redis (connect + ping) → serve.
// Lỗi bước nào → log `fatal` + exit 1.
import { SSE_HEARTBEAT_S } from "@ai/contracts/chat";
import pkg from "../package.json";
import { createApp } from "./app";
import { type Env, loadEnv } from "./config/env";
import { envAppDeps } from "./config/env-deps";
import { connectDb, type Db, pingDb } from "./lib/db";
import { safeErrorFields } from "./lib/errors";
import { importJwtPublicKey } from "./lib/jwt";
import { logger, setMinLevel } from "./lib/logger";
import { createRedis, pingRedis, type Redis } from "./lib/redis";
import { bootOrchestratorProblem } from "./modules/config/config.service";
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

/** SSE: Bun mặc định đóng kết nối im > 10 s, trước nhịp `: ping` (SSE_HEARTBEAT_S) → đặt gấp đôi nhịp ping. */
function serve(
  env: Env,
  fetch: (req: Request, server: Bun.Server<undefined>) => Response | Promise<Response>,
) {
  const server = Bun.serve({ port: env.HUB_PORT, fetch, idleTimeout: SSE_HEARTBEAT_S * 2 });
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
  const jwtPublicKey = await importJwtPublicKey(env.JWT_PUBLIC_KEY).catch((err) =>
    fail("jwt", err),
  );
  const db = await openDb(env).catch((err) => fail("db", err));
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
      ...envAppDeps(env, logger),
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
