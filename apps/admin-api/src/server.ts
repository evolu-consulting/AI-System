// ADM-NFR-06, ADM-NFR-07, ADM-NFR-01 · điểm khởi động admin-api: nơi duy nhất đọc env và mở cổng.
// Thứ tự (plan M1 §2, M2 §3.2): env → khoá JWT (ký thử) → SECRET_MASTER_KEY (mã hoá thử) → DB bằng ADMIN_API_DATABASE_URL → assertSafeDbRole → hash giả → serve.
// Lỗi bất kỳ bước nào → log (không in giá trị env) + exit 1, không lắng nghe cổng.
import { createDb, type Db } from "@ai/db";
import pkg from "../package.json";
import { createApp, defaultHashSlots } from "./app";
import { loadEnv } from "./config/env";
import { assertSafeDbRole } from "./lib/db-guard";
import { loadJwtKeys } from "./lib/jwt";
import { logger, setMinLevel } from "./lib/logger";
import { createMailer } from "./lib/mailer";
import { createRedis, type Redis } from "./lib/redis";
import { parseMasterKey, selfTestSecretKey } from "./lib/secret-crypto";
import { seedAppUrls } from "./modules/app-catalog/app-catalog.seed";
import { createDummyHash } from "./modules/auth/auth.service";
import { type LoginLimiter, redisLoginLimiter } from "./modules/auth/limit/limit.redis";
import { type LimitPolicy, policyFromEnv } from "./modules/auth/limit/limit.rules";
import { redisSsoStore } from "./modules/auth/sso/sso.store";
import { trelloFromEnv } from "./modules/feedback/feedback.trello";

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

function fail(step: string, err: unknown): never {
  logger.error(step, { error: errMsg(err) });
  process.exit(1);
}

async function connect(url: string): Promise<Db> {
  const db = createDb(url, { max: 10 });
  try {
    await assertSafeDbRole(db);
    return db;
  } catch (err) {
    await db.close();
    // Lỗi kết nối của postgres.js không chứa mật khẩu; vẫn nhắc biến cần kiểm.
    throw new Error(`${errMsg(err)} (kiểm tra ADMIN_API_DATABASE_URL)`);
  }
}

/** T1: chờ Redis sẵn sàng trước khi lắng nghe tối đa chừng này (lưới an toàn; chờ theo tín hiệu `connect()`). */
const REDIS_READY_WAIT_MS = 3_000;

/**
 * L1 (#224): giới hạn đăng nhập trên Redis. Production thiếu REDIS_URL ⇒ không khởi động. T1: chờ lần nối đầu (client
 * tắt offline queue ⇒ login ngay sau `listening` từng 503 vì chưa nối xong); Redis không lên trong REDIS_READY_WAIT_MS
 * ⇒ vẫn lắng nghe, login 503 AUTH_UNAVAILABLE (đóng an toàn) tới khi ioredis nối lại.
 */
async function startLoginLimiter(
  env: ReturnType<typeof loadEnv>,
): Promise<{ limiter: LoginLimiter; redis: Redis } | undefined> {
  let policy: LimitPolicy;
  try {
    policy = policyFromEnv(env.APP_ENV, env.LOGIN_IP_MAX_ATTEMPTS);
  } catch (err) {
    fail("env", err);
  }
  if (!env.REDIS_URL) {
    if (env.APP_ENV === "production")
      fail("env", new Error("REDIS_URL bắt buộc ở production (L1)"));
    logger.warn("login-limit-disabled", { reason: "REDIS_URL vắng, không giới hạn đăng nhập" });
    return undefined;
  }
  const redis = createRedis(env.REDIS_URL);
  redis.on("error", (err: Error) => logger.warn("redis", { error: err.message }));
  const ready = redis.connect().then(
    () => true,
    (err) => {
      logger.warn("redis-connect", { error: errMsg(err) });
      return false;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<false>((r) => {
    timer = setTimeout(() => r(false), REDIS_READY_WAIT_MS);
  });
  if (!(await Promise.race([ready, late]))) logger.warn("redis-not-ready", { op: "login-limit" });
  clearTimeout(timer);
  return { limiter: redisLoginLimiter(redis, { policy }), redis };
}

async function main(): Promise<void> {
  setMinLevel("info");
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    fail("env", err);
  }
  if (!env.SMTP_URL) logger.warn("mailer-disabled", { reason: "SMTP_URL vắng, không gửi mail" });
  const keys = await loadJwtKeys(env).catch((err) => fail("jwt", err));
  let secretKey: ReturnType<typeof parseMasterKey>;
  try {
    secretKey = parseMasterKey(env.SECRET_MASTER_KEY);
    selfTestSecretKey(secretKey);
  } catch (err) {
    fail("secret-key", err);
  }
  const db = await connect(env.ADMIN_API_DATABASE_URL).catch((err) => fail("db", err));
  await seedAppUrls(db, env).then(
    (n) => n > 0 && logger.info("app-catalog-seeded", { apps: n }),
    (err) => logger.warn("app-catalog-seed", { error: errMsg(err) }),
  );
  const dummyHash = await createDummyHash();
  const limit = await startLoginLimiter(env);
  const app = createApp(
    { version: pkg.version, corsOrigins: env.CORS_ORIGINS },
    {
      db,
      keys,
      appEnv: env.APP_ENV,
      dummyHash,
      legacySunset: env.LEGACY_HASH_SUNSET,
      secretKey,
      mailer: createMailer(env),
      adminWebUrl: env.ADMIN_WEB_URL,
      frozenModules: env.ADMIN_FROZEN_MODULES === "on",
      difyConsoleUrl: env.DIFY_CONSOLE_URL,
      trello: trelloFromEnv(env),
      loginLimiter: limit?.limiter,
      // sso-switch: mã chuyển phiên dùng chung Redis của giới hạn đăng nhập (production bắt buộc có).
      ssoStore: limit ? redisSsoStore(limit.redis) : undefined,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      hashSlots: defaultHashSlots(env.LOGIN_HASH_CONCURRENCY),
      hub:
        env.ADMIN_HUB_URL && env.HUB_INTERNAL_TOKEN
          ? { url: env.ADMIN_HUB_URL, token: env.HUB_INTERNAL_TOKEN }
          : undefined,
    },
  );
  const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
  logger.info("listening", { port: server.port, app_env: env.APP_ENV, version: pkg.version });
}

await main();
