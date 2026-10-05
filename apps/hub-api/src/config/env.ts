// HUB-NFR-04 · env của hub-api (plan H1 §7), validate bằng zod. Lỗi chỉ nêu tên biến, không in giá trị.
import { hostname } from "node:os";
import { z } from "zod";
import { isMasterKeyB64 } from "../lib/secret-crypto";

const OriginList = z
  .string()
  .transform((s) =>
    s
      .split(",")
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

export const LOG_LEVELS = ["debug", "info", "warn", "error", "fatal"] as const;

export const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  HUB_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  // Role hub_api (NOBYPASSRLS), không phải owner DATABASE_URL (plan §3.4).
  HUB_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  JWT_PUBLIC_KEY: z.string().includes("-----BEGIN PUBLIC KEY-----"),
  HUB_INSTANCE_ID: z
    .string()
    .min(1)
    .max(128)
    .default(() => `${hostname()}:${process.pid}`),
  HUB_JOB_MAX_WAIT_S: z.coerce.number().int().min(1).default(30),
  HUB_CONFIG_POLL_S: z.coerce.number().int().min(1).default(60),
  HUB_CORS_ORIGINS: OriginList.default(["http://localhost:3100"]),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  // H2a plan §8: chung với admin-api (base64 32 byte). Vắng → gọi Dify luôn NOT_CONFIGURED; sai → env lỗi (fatal).
  SECRET_MASTER_KEY: z.string().refine(isMasterKeyB64).optional(),
  // H2a plan §8: token dịch vụ của `/internal/test-run` (≥ 32 ký tự); vắng → route đó 503 `UNAVAILABLE`.
  HUB_INTERNAL_TOKEN: z.string().min(32).optional(),
  // H2a plan §8: `mcp.url` = `<HUB_PUBLIC_INTERNAL_URL>/mcp` trong payload job agent. Mặc định chỉ ở development/test
  // (`loadEnv`); môi trường khác vắng → MCP tắt (payload `mcp=null`) — REVIEW 1 Hub #10.
  HUB_PUBLIC_INTERNAL_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Hạn tối đa một lời gọi tool Dify.
  HUB_DIFY_TIMEOUT_MAX_S: z.coerce.number().int().min(1).max(3600).default(300),
  // H2b plan §4 · số run `running` tối đa mỗi user; kiểm ở `envAppDeps` (`parseMaxConcurrentRuns`: vắng → 2, 1–20).
  HUB_MAX_CONCURRENT_RUNS: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Mặc định `HUB_PUBLIC_INTERNAL_URL` khi `APP_ENV` = development/test (Hub cùng máy Runtime). */
export const DEV_PUBLIC_INTERNAL_URL = "http://localhost:4000";

/** Chuỗi rỗng (`HUB_INSTANCE_ID=` trong .env.example) coi như vắng để nhận mặc định. */
function dropEmpty(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== "") out[k] = v;
  return out;
}

function withDevDefaults(env: Env): Env {
  if (env.HUB_PUBLIC_INTERNAL_URL !== undefined || env.APP_ENV === "production") return env;
  return { ...env, HUB_PUBLIC_INTERNAL_URL: DEV_PUBLIC_INTERNAL_URL };
}

/** Ném Error liệt kê tên biến sai; không bao giờ in giá trị (có thể là secret). */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(dropEmpty(source));
  if (r.success) return withDevDefaults(r.data);
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
