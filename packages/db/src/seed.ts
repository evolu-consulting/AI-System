// ADM-NFR-06 · seed idempotent (spec M1 §4, M1-R20/R21): tenant `platform`, feature `core`, platform_admin đầu tiên.
// CLI: `bun run db:seed` (owner DATABASE_URL). Lỗi chỉ nêu tên biến, không in giá trị.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, USERNAME_RE } from "@ai/contracts";
import postgres from "postgres";
import { z } from "zod";
import { AppEnvSchema } from "./env";
import { describeError } from "./migrate";
import { hashPassword } from "./password";

export const SeedEnvSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_ENV: AppEnvSchema,
  SEED_ADMIN_USERNAME: z.string().regex(USERNAME_RE),
  SEED_ADMIN_PASSWORD: z.string().min(PASSWORD_MIN_LEN).max(PASSWORD_MAX_LEN),
});
export type SeedEnv = z.infer<typeof SeedEnvSchema>;

export function loadSeedEnv(src: Record<string, string | undefined>): SeedEnv {
  const r = SeedEnvSchema.safeParse(src);
  if (r.success) return r.data;
  const names = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? "?")))];
  throw new Error(`Env không hợp lệ: ${names.join(", ")}`);
}

type Outcome = "created" | "exists";
export type SeedResult = { tenant: Outcome; feature: Outcome; admin: Outcome };

export const PLATFORM_TENANT = { key: "platform", name: "Nền tảng" } as const;
export const CORE_FEATURE = { key: "core", name: { vi: "Cơ bản", en: "Core" } } as const;

/** Một transaction (owner). `ON CONFLICT DO NOTHING` → lần 2 không đổi gì, kể cả password_hash. */
export async function runSeed(opts: {
  url: string;
  adminUsername: string;
  adminPassword: string;
}): Promise<SeedResult> {
  const sql = postgres(opts.url, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin(async (tx) => {
      const ins = await tx<{ id: string }[]>`insert into admin.tenants (id, key, name)
        values (${Bun.randomUUIDv7()}, ${PLATFORM_TENANT.key}, ${PLATFORM_TENANT.name})
        on conflict (key) do nothing returning id`;
      const tenant: Outcome = ins.length ? "created" : "exists";
      const [row] = ins.length
        ? ins
        : await tx<
            { id: string }[]
          >`select id from admin.tenants where key = ${PLATFORM_TENANT.key}`;
      if (!row) throw new Error("db:seed: không đọc được tenant platform");
      const f = await tx`insert into admin.features (id, key, name, status)
        values (${Bun.randomUUIDv7()}, ${CORE_FEATURE.key}, ${tx.json(CORE_FEATURE.name)}, 'on')
        on conflict (key) do nothing returning id`;
      const admin = await seedAdmin(tx, row.id, opts.adminUsername, opts.adminPassword);
      return { tenant, feature: f.length ? "created" : "exists", admin };
    });
  } finally {
    await sql.end();
  }
}

async function seedAdmin(
  tx: postgres.TransactionSql,
  tenantId: string,
  username: string,
  password: string,
): Promise<Outcome> {
  const found =
    await tx`select 1 from admin.users where tenant_id = ${tenantId} and username = ${username}`;
  if (found.length) return "exists";
  // Chỉ băm khi cần tạo (argon2 ~22 ms) — lần chạy lại không tốn và không đổi hash.
  const hash = await hashPassword(password);
  const ins = await tx`insert into admin.users
    (id, tenant_id, username, password_hash, display_name, role, locale, must_change_password)
    values (${Bun.randomUUIDv7()}, ${tenantId}, ${username}, ${hash}, 'Platform Admin',
            'platform_admin', 'vi', false)
    on conflict (tenant_id, username) do nothing returning id`;
  return ins.length ? "created" : "exists";
}

if (import.meta.main) {
  try {
    const env = loadSeedEnv(process.env);
    const r = await runSeed({
      url: env.DATABASE_URL,
      adminUsername: env.SEED_ADMIN_USERNAME,
      adminPassword: env.SEED_ADMIN_PASSWORD,
    });
    console.log(`db:seed OK: tenant ${r.tenant}, feature ${r.feature}, admin ${r.admin}`);
  } catch (err) {
    console.error(`db:seed lỗi: ${describeError(err)}`);
    process.exit(1);
  }
}
