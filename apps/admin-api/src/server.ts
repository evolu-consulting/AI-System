// ADM-NFR-06 · điểm khởi động admin-api: nơi duy nhất đọc env và mở cổng.
import pkg from "../package.json";
import { createApp } from "./app";
import { type Env, loadEnv } from "./config/env";
import { logger } from "./lib/logger";

function readEnvOrExit(): Env {
  try {
    return loadEnv(process.env);
  } catch (err) {
    logger.error("env", { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

const env = readEnvOrExit();
const app = createApp({ version: pkg.version, corsOrigins: env.CORS_ORIGINS });
const server = Bun.serve({ port: env.PORT, fetch: app.fetch });
logger.info("listening", { port: server.port, app_env: env.APP_ENV, version: pkg.version });
