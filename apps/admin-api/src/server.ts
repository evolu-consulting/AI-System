// ADM-NFR-06, ADM-NFR-07, ADM-NFR-01 · điểm khởi động admin-api: nơi duy nhất đọc env và mở cổng.
// Thứ tự (plan M1 §2): env → khoá JWT (ký thử) → DB bằng ADMIN_API_DATABASE_URL → assertSafeDbRole → hash giả → serve.
// Lỗi bất kỳ bước nào → log (không in giá trị env) + exit 1, không lắng nghe cổng.
import { createDb, type Db } from "@ai/db";
import pkg from "../package.json";
import { createApp } from "./app";
import { loadEnv } from "./config/env";
import { assertSafeDbRole } from "./lib/db-guard";
import { loadJwtKeys } from "./lib/jwt";
import { logger } from "./lib/logger";
import { createDummyHash } from "./modules/auth/auth.service";

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

async function main(): Promise<void> {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv(process.env);
  } catch (err) {
    fail("env", err);
  }
  const keys = await loadJwtKeys(env).catch((err) => fail("jwt", err));
  const db = await connect(env.ADMIN_API_DATABASE_URL).catch((err) => fail("db", err));
  const dummyHash = await createDummyHash();
  const app = createApp(
    { version: pkg.version, corsOrigins: env.CORS_ORIGINS },
    { db, keys, appEnv: env.APP_ENV, dummyHash },
  );
  const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
  logger.info("listening", { port: server.port, app_env: env.APP_ENV, version: pkg.version });
}

await main();
