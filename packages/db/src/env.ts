// ADM-NFR-06 · env của packages/db (DATABASE_URL, APP_ENV). Lỗi chỉ nêu tên biến, không in giá trị.
import { z } from "zod";

export const AppEnvSchema = z.enum(["development", "test", "production"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

export const DbEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_ENV: AppEnvSchema,
});

export type DbEnv = z.infer<typeof DbEnvSchema>;

export function loadDbEnv(source: Record<string, string | undefined>): DbEnv {
  const r = DbEnvSchema.safeParse(source);
  if (r.success) return r.data;
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}
