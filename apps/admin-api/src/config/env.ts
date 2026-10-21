// ADM-NFR-06, ADM-NFR-07, ADM-NFR-01, ADM-FR-50, ADM-FR-23 · env của admin-api (spec M0 §7, M1 §7, M2 §4). Lỗi chỉ nêu tên biến.
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

const Pem = (kind: "PRIVATE" | "PUBLIC") => z.string().includes(`-----BEGIN ${kind} KEY-----`);

export const EnvSchema = z.object({
  APP_ENV: z.enum(["development", "test", "production"]),
  PORT: z.coerce.number().int().min(1).max(65535),
  CORS_ORIGINS: OriginList,
  // Role admin_api (NOBYPASSRLS), không phải owner DATABASE_URL (spec M1 §4).
  ADMIN_API_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  JWT_PRIVATE_KEY: Pem("PRIVATE"),
  JWT_PUBLIC_KEY: Pem("PUBLIC"),
  JWT_KID: z.string().min(1).max(64),
  /** 32 byte base64 (`^[A-Za-z0-9+/]{43}=$`), mã hoá secret (M2-R02). */
  SECRET_MASTER_KEY: z.string().refine(isMasterKeyB64),
  /** Vắng = tắt gửi mail (cảnh báo lúc khởi động). ADM-FR-41, plan-cd §10. */
  SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
  MAIL_FROM: z.string().max(200).optional(),
  /** Gốc admin-web cho link trong mail cảnh báo quota (plan M4 §7). ADM-FR-41. */
  ADMIN_WEB_URL: z.url({ protocol: /^https?$/ }).default("http://localhost:3000"),
  /** app-catalog · URL khởi tạo cho `admin.app_catalog` (chỉ điền hàng còn rỗng lúc khởi động); vắng ⇒ để trống. */
  APP_URL_CHAT: z.url({ protocol: /^https?$/ }).optional(),
  APP_URL_CONTRACTS: z.url({ protocol: /^https?$/ }).optional(),
  APP_URL_STUDIO: z.url({ protocol: /^https?$/ }).optional(),
  APP_URL_ADMIN: z.url({ protocol: /^https?$/ }).optional(),
  /** F1 (CR-095) · module đóng băng (workflows, workflow-tools, transfer, commands; docs/platform/modules.md): `off` (mặc định) ⇒ không mount route. Dev/test bật. */
  ADMIN_FROZEN_MODULES: z.enum(["on", "off"]).default("off"),
  /** Gốc Hub cho "Chạy thử" lệnh (ADM-FR-23, X1 §2.2). Không dùng tên `HUB_URL` (dành cho chat). Vắng ⇒ 503. */
  ADMIN_HUB_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Token dịch vụ Hub `/internal/*` — chỉ server-side, cùng giá trị với hub-api. Vắng ⇒ 503. */
  HUB_INTERNAL_TOKEN: z.string().min(32).optional(),
  /** N5B-FR-04: hạn nhận hash scrypt legacy mgmt-app, `YYYY-MM-DD` = 00:00 UTC. Vắng ⇒ mặc định trong auth.legacy.rules. */
  LEGACY_HASH_SUNSET: z.iso
    .date()
    .transform((d) => new Date(`${d}T00:00:00.000Z`))
    .optional(),
  /** L1 (#224): Redis cho giới hạn đăng nhập. Bắt buộc khi `APP_ENV=production` (kiểm ở server.ts); vắng ở dev ⇒ không giới hạn. */
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).optional(),
  /** L1: số reverse proxy tin cậy trước admin-api (IP client từ X-Forwarded-For). 0 ⇒ IP socket. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).optional(),
  /** L1: trần phép băm mật khẩu đồng thời; vắng ⇒ số lõi (≥ 2). */
  LOGIN_HASH_CONCURRENCY: z.coerce.number().int().min(1).max(64).optional(),
  /** T1: trần lượt đăng nhập mỗi IP / 10' (mặc định 30). Chỉ dev/test (e2e song song từ một IP); production ⇒ không khởi động. */
  LOGIN_IP_MAX_ATTEMPTS: z.coerce.number().int().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Ném Error liệt kê tên biến sai; không bao giờ in giá trị (có thể là secret). */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(dropEmptyEnv(source)); // "" ⇒ vắng (#193)
  if (r.success) return r.data;
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
