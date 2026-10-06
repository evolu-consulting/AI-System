// ADM-NFR-06, ADM-NFR-07, ADM-NFR-01, ADM-FR-50, ADM-FR-23 · env của admin-api (spec M0 §7, M1 §7, M2 §4). Lỗi chỉ nêu tên biến.
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
  /** Gốc Hub cho "Chạy thử" lệnh (ADM-FR-23, X1 §2.2). Không dùng tên `HUB_URL` (dành cho chat). Vắng ⇒ 503. */
  ADMIN_HUB_URL: z.url({ protocol: /^https?$/ }).optional(),
  /** Token dịch vụ Hub `/internal/*` — chỉ server-side, cùng giá trị với hub-api. Vắng ⇒ 503. */
  HUB_INTERNAL_TOKEN: z.string().min(32).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** Ném Error liệt kê tên biến sai; không bao giờ in giá trị (có thể là secret). */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(source);
  if (r.success) return r.data;
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
