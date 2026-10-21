// HUB-NFR-04 · env của hub-api (plan H1 §7), validate bằng zod. Lỗi chỉ nêu tên biến, không in giá trị.
import { hostname } from "node:os";
import { isAbsolute } from "node:path";
import { dropEmptyEnv } from "@ai/contracts";
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
  // R1 · pool riêng của module tri thức (role `knowledge_api`, chỉ SET ROLE `knowledge_rw`); vắng ⇒ DSN chính ở trên.
  KNOWLEDGE_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
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
  // FB1 (HUB-FR-138/141, core-only): driver `filebox` (kiểm ở `parseAttachEnv`). Bearer đọc thẳng từ `FILEBOX_TOKEN` (không log).
  FILEBOX_URL: z.string().optional(),
  FILEBOX_ORG: z.string().optional(),
  FILEBOX_CA: z.string().optional(),
  FILEBOX_TOKEN: z.string().optional(),
  FILEBOX_TIMEOUT_MS: z.string().optional(),
  FILEBOX_HTTP_HOSTS: z.string().optional(), // FileBox riêng nội bộ: host (tên service Docker) được dùng http
  FILEBOX_PUBLIC_PATH: z.string().optional(), // tiền tố công khai cho link tải (nginx proxy tới FileBox nội bộ)
  // DLC-R11 · engine AI SDLC (agent `dlc`) cho `/dlc/*` (sidebar Workspaces, modal Process). Vắng URL ⇒ `engine:
  // not_configured`. Client Keycloak (client_credentials) tuỳ chọn, đặt đủ ba biến; CA = PEM của Keycloak tự ký.
  HUB_DLC_URL: z.url({ protocol: /^https?$/ }).optional(),
  HUB_DLC_TOKEN_URL: z.url({ protocol: /^https?$/ }).optional(),
  HUB_DLC_CLIENT_ID: z.string().min(1).optional(),
  HUB_DLC_CLIENT_SECRET: z.string().min(1).optional(),
  HUB_DLC_CA_FILE: z.string().optional(),
  // H4a plan §9 · bản build Studio (đường dẫn tuyệt đối); thiếu `index.html` ⇒ warn `studio-dist-missing`, không mount.
  HUB_STUDIO_DIST: z
    .string()
    .refine((p) => isAbsolute(p))
    .optional(),
  // P-a D15 · cờ Process Engine: `off` (mặc định) ⇒ không mount route quy trình, `!` là chữ thường. Dev bật ở F6.
  HUB_PROCESS_ENGINE: z.enum(["on", "off"]).default("off"),
  // F1 (CR-095) · cờ module đóng băng (docs/platform/modules.md): `off` (mặc định) ⇒ không mount route công khai của quy trình,
  // phòng, nguồn, KH, DLC; engine quy trình vẫn chạy nội bộ khi `HUB_PROCESS_ENGINE=on` (gói hợp đồng dùng). Dev/test bật.
  HUB_FROZEN_MODULES: z.enum(["on", "off"]).default("off"),
  // chat-fast · `on` ⇒ tin không tag mà người gửi chỉ thấy đúng 1 agent → chạy thẳng agent đó (bỏ job Orchestrator, cùng kiểm
  // quyền). Mặc định `off` (test khoá giữ hành vi cũ); production bật trong compose.
  HUB_FAST_ROUTE: z.enum(["on", "off"]).default("off"),
  // CR-081 · seed opt-in fixtures: "1"/"true" ⇒ `hub:seed` nạp THÊM `*.full.yaml` (16 agent vai, 7 mẫu quy trình, teams,
  // entitlements/grants, tenant_processes); vắng ⇒ seed TỐI GIẢN (orchestrator + assistant + dify-* + providers + workflows).
  HUB_SEED_FIXTURES: z.string().optional(),
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
  // N3 · cổng thông báo: `off` (mặc định, không worker) · `fake` (dev/e2e, transport giả) · `live` (chờ ADR-0027 ⇒ Hub không lên).
  HUB_NOTIFY_MODE: z.enum(["off", "fake", "live"]).default("off"),
  // N3 · gốc URL app dựng liên kết tuyệt đối trong email; khoá công khai VAPID (KHÔNG bí mật) cho trình duyệt đăng ký push.
  HUB_NOTIFY_BASE_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3300"),
  HUB_VAPID_PUBLIC_KEY: z.string().max(256).optional(),
  // N3 live (ADR-0027): MỘT bộ SMTP nền tảng, giá trị cố định mặc định (tạm). Bí mật KHÔNG có mặc định: `SMTP_PASSWORD` /
  // `VAPID_PRIVATE_KEY` (env) hoặc kho secret Hub (`smtp_password` / `vapid_private_key`). Tên bí mật không có tiền tố HUB_.
  HUB_SMTP_HOST: z.string().min(1).default("smtp.gmail.com"),
  HUB_SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  HUB_SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  HUB_SMTP_USER: z.string().default(""),
  HUB_SMTP_FROM: z.string().min(3).default("no-reply@example.com"),
  HUB_VAPID_SUBJECT: z.string().min(1).default("mailto:admin@example.com"),
  SMTP_PASSWORD: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Mặc định `HUB_PUBLIC_INTERNAL_URL` khi `APP_ENV` = development/test (Hub cùng máy Runtime). */
export const DEV_PUBLIC_INTERNAL_URL = "http://localhost:4000";

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
  const r = EnvSchema.safeParse(dropEmptyEnv(source));
  if (r.success) return withDevDefaults(r.data);
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
