// ADM-NFR-06, ADM-NFR-07, ADM-NFR-01 · env của admin-api (spec M0 §7, M1 §7). Lỗi chỉ nêu tên biến.
import { z } from "zod";

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
});

export type Env = z.infer<typeof EnvSchema>;

/** Ném Error liệt kê tên biến sai; không bao giờ in giá trị (có thể là secret). */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(source);
  if (r.success) return r.data;
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
