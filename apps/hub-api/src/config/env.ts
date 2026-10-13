// HUB-NFR-04 · env của hub-api (plan H1 §7), validate bằng zod. Lỗi chỉ nêu tên biến, không in giá trị.
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
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
  // H4b-1 plan §4, D10 · khoá secrets của Hub (base64 32 byte, KHÁC SECRET_MASTER_KEY). Bắt buộc mọi môi trường nhưng kiểm
  // ở `server.ts` (`checkHubSecretsKey`) để log đúng `reason` (missing|invalid|same_as_master|self_test), không phải lỗi zod chung.
  HUB_SECRETS_KEY: z.string().optional(),
  // H2a plan §8: token dịch vụ của `/internal/test-run` (≥ 32 ký tự); vắng → route đó 503 `UNAVAILABLE`.
  HUB_INTERNAL_TOKEN: z.string().min(32).optional(),
  // H2a plan §8: `mcp.url` = `<HUB_PUBLIC_INTERNAL_URL>/mcp` trong payload job agent. Mặc định chỉ ở development/test
  // (`loadEnv`); môi trường khác vắng → MCP tắt (payload `mcp=null`) — REVIEW 1 Hub #10.
  HUB_PUBLIC_INTERNAL_URL: z.url({ protocol: /^https?$/ }).optional(),
  // Hạn tối đa một lời gọi tool Dify.
  HUB_DIFY_TIMEOUT_MAX_S: z.coerce.number().int().min(1).max(3600).default(300),
  // H2b plan §4 · số run `running` tối đa mỗi user; kiểm ở `envAppDeps` (`parseMaxConcurrentRuns`: vắng → 2, 1–20).
  HUB_MAX_CONCURRENT_RUNS: z.string().optional(),
  // H2c plan §7 · file đính kèm; kiểm ở `attachEnvOf` (`parseAttachEnv`: driver `local`, dir tuyệt đối, hạn mức, nhịp sweeper).
  HUB_ATTACH_DRIVER: z.string().optional(),
  HUB_ATTACH_DIR: z.string().optional(),
  HUB_ATTACH_TENANT_MAX_BYTES: z.string().optional(),
  HUB_ATTACH_SWEEP_S: z.string().optional(),
  // H4a plan §9 · bản build Studio (đường dẫn tuyệt đối); thiếu `index.html` ⇒ warn `studio-dist-missing`, không mount.
  HUB_STUDIO_DIST: z
    .string()
    .refine((p) => isAbsolute(p))
    .optional(),
  // P-a D15 · cờ Process Engine: `off` (mặc định) ⇒ không mount route quy trình, `!` là chữ thường. Dev bật ở F6.
  HUB_PROCESS_ENGINE: z.enum(["on", "off"]).default("off"),
  // K1 spec §7, plan §11 G1 · origin KnowledgeHub được phép (cách dấu phẩy). Vắng: production ⇒ [] (không lưu được kết nối);
  // development/test ⇒ mock KH loopback (`khConfigOf`).
  HUB_KH_ALLOWED_ORIGINS: z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    )
    .pipe(z.array(z.url({ protocol: /^https?$/ })))
    .optional(),
  // Hạn mỗi lời gọi KH (ms); ngoài 1000..30000 ⇒ env lỗi, dừng khởi động.
  HUB_KH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(5000),
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

/** Mock KH dev/test (`KH_MOCK_PORT` = 4030) khi `HUB_KH_ALLOWED_ORIGINS` vắng ngoài production (spec K1 §7). */
export const DEV_KH_ALLOWED_ORIGINS = ["http://localhost:4030", "http://127.0.0.1:4030"] as const;

/** Cấu hình KH (plan K1 §11 G1 — `AppDeps.kh`): origin chuẩn hoá (`URL.origin`), hạn mỗi lời gọi. */
export type KhConfig = { allowedOrigins: string[]; timeoutMs: number };

export function khConfigOf(
  env: Pick<Env, "APP_ENV" | "HUB_KH_ALLOWED_ORIGINS" | "HUB_KH_TIMEOUT_MS">,
): KhConfig {
  const raw =
    env.HUB_KH_ALLOWED_ORIGINS ?? (env.APP_ENV === "production" ? [] : [...DEV_KH_ALLOWED_ORIGINS]);
  return {
    allowedOrigins: [...new Set(raw.map((o) => new URL(o).origin))],
    timeoutMs: env.HUB_KH_TIMEOUT_MS,
  };
}

/** Ném Error liệt kê tên biến sai; không bao giờ in giá trị (có thể là secret). */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(dropEmpty(source));
  if (r.success) return withDevDefaults(r.data);
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
