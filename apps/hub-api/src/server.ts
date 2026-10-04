// HUB-NFR-04 · điểm khởi động hub-api: nơi duy nhất đọc env và mở cổng (plan H1 §4, §7).
// Thứ tự: env → khoá JWT công khai → DB (`HUB_DATABASE_URL`, ping) → Orchestrator hợp lệ (HUB-BR-08) → Redis (connect + ping) → serve.
// Lỗi bước nào → log `fatal` + exit 1.
import pkg from "../package.json";
import { createApp } from "./app";
import { type Env, loadEnv } from "./config/env";
import { connectDb, type Db, pingDb } from "./lib/db";
import { safeErrorFields } from "./lib/errors";
import { importJwtPublicKey } from "./lib/jwt";
import { logger, setMinLevel } from "./lib/logger";
import { createRedis, pingRedis, type Redis } from "./lib/redis";
import { bootOrchestratorProblem } from "./modules/config/config.service";

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

async function main(): Promise<void> {
  let env: Env;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    fail("env", err);
  }
  setMinLevel(env.LOG_LEVEL);
  const jwtPublicKey = await importJwtPublicKey(env.JWT_PUBLIC_KEY).catch((err) =>
    fail("jwt", err),
  );
  const db = await openDb(env).catch((err) => fail("db", err));
  const problem = await bootOrchestratorProblem(db).catch((err) => fail("orchestrator", err));
  if (problem) {
    logger.fatal("orchestrator-invalid", { reason: problem });
    await db.close();
    process.exit(1);
  }
  const redis = await openRedis(env).catch((err) => fail("redis", err));
  const stop = new AbortController();
  const app = createApp(
    { version: pkg.version, corsOrigins: env.HUB_CORS_ORIGINS },
    {
      probes: [() => pingDb(db), () => pingRedis(redis)],
      db,
      redis,
      jwtPublicKey,
      appEnv: env.APP_ENV,
      instanceId: env.HUB_INSTANCE_ID,
      jobMaxWaitS: env.HUB_JOB_MAX_WAIT_S,
      configPollS: env.HUB_CONFIG_POLL_S,
      signal: stop.signal,
    },
  );
  const server = Bun.serve({ port: env.HUB_PORT, fetch: app.fetch });
  logger.info("listening", {
    port: server.port,
    app_env: env.APP_ENV,
    instance_id: env.HUB_INSTANCE_ID,
    version: pkg.version,
  });

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
