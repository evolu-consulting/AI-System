// seed-refresh · fixture theo công ty cho máy dev/test (tenant `evolu` + `demo`): mọi tính năng CR-105..111 chạy ngay sau
// `hub:seed` (HUB_SEED_FIXTURES=1) mà không cần SQL/API tay. Chạy cùng transaction của `hub:seed` (owner) và độc lập bằng CLI
// (`bun run hub:seed:fixtures`) vì tenant `demo` do dev-up tạo SAU `hub:seed`. Idempotent (on conflict / where thiếu), số câu SQL
// cố định (không theo số hàng), tenant chưa có ⇒ bỏ qua êm. CHẶN production: `libSampleEnabled` (fixtures bật + appEnv ≠ production).
// KHÔNG gồm `han-muc-duyet` (feature chỉ cấp tay trên prod). Không đổi migration đã áp dụng.
import postgres from "postgres";
import { z } from "zod";
import { logger } from "../../lib/logger";
import { libSampleEnabled } from "./seed.library-sample";
import type { Tx } from "./seed.repo";

/** Công ty fixture. Khoá khớp `tools/hub-dev/src/fixture.ts` (evolu) và `seed-community-demo.dev-fixture.ts` (demo). */
export const FIXTURE_TENANTS = ["evolu", "demo"] as const;
/** Feature bật duyệt HĐ trên engine (cần thêm env hub `CONTRACTS_APPROVAL_ENGINE=on`). */
export const FIXTURE_FEATURES = ["contracts-approval-engine"] as const;
const OWNER_GROUPS = ["contracts-owner", "community-owner"] as const;
const EDITOR_GROUPS = ["contracts-editor", "community-editor"] as const;
/** Chỉ evolu có user thường ⇒ editor của gói; `demo` giữ nguyên vai theo `deploy/tenants/demo.yaml`. */
const EDITOR_TENANTS = ["evolu"] as const;

/** Phòng Kế toán (mã `pb-ke-toan` = bước "Kế toán duyệt" của "QT thử") + 2 thành viên (username HOẶC email). */
export const ACCOUNTING = {
  key: "pb-ke-toan",
  name: { vi: "Phòng Kế toán", en: "Accounting" },
  members: {
    evolu: ["thomas.tran", "vio.ngo"],
    demo: ["demo-viewer@example.invalid", "demo-editor@example.invalid"],
  },
} as const;

/** Nhận diện công ty (company_settings) cho host của Community/Sổ Hợp Tác; logo null (không nhúng ảnh). */
export const BRANDS = [
  { tenant: "evolu", company: "Evolu", app: "Evolu Hợp Tác", accent: "teal" },
  { tenant: "demo", company: "Demo Sổ Hợp Tác", app: "Sổ Hợp Tác", accent: "indigo" },
] as const;

/** URL app cho dev (admin-api :3001 là API, không phải app). Chỉ điền ô còn rỗng, không đè giá trị admin đã sửa. */
export const DEV_APP_URLS: Record<string, string> = {
  admin: "http://localhost:3000",
  chat: "http://localhost:3100",
  studio: "http://localhost:3200",
  contracts: "http://localhost:3300",
  community: "http://localhost:3400",
};

export type TenantFixtureResult = {
  tenants: number;
  locale: number;
  features: number;
  accountingGroups: number;
  accountingMembers: number;
  ownerMembers: number;
  editorMembers: number;
  brands: number;
  catalogUrls: number;
};

const keys = [...FIXTURE_TENANTS];

export async function writeTenantFixtures(tx: Tx, appEnv: string): Promise<TenantFixtureResult> {
  const t = await tx`select id from admin.tenants where key = any(${keys}::text[])`;
  const r: TenantFixtureResult = {
    tenants: t.length,
    locale: 0,
    features: 0,
    accountingGroups: 0,
    accountingMembers: 0,
    ownerMembers: 0,
    editorMembers: 0,
    brands: 0,
    catalogUrls: 0,
  };
  if (t.length > 0) {
    // 5: UI tiếng Việt mặc định — user tạo qua first_admin của POST /admin/tenants nhận locale mặc định `en`.
    r.locale = (
      await tx`update admin.users u set locale = 'vi' from admin.tenants tn
        where u.tenant_id = tn.id and tn.key = any(${keys}::text[]) and u.locale <> 'vi' returning u.id`
    ).length;
    // 3: feature duyệt HĐ bằng engine cho cả hai công ty fixture (đã thu hồi ⇒ cấp lại).
    r.features = (
      await tx`insert into admin.feature_entitlements (feature_id, tenant_id)
        select f.id, tn.id from admin.features f join admin.tenants tn on tn.key = any(${keys}::text[])
        where f.key = any(${[...FIXTURE_FEATURES]}::text[])
        on conflict (feature_id, tenant_id) do update set revoked_at = null, granted_at = now()
          where admin.feature_entitlements.revoked_at is not null
        returning feature_id`
    ).length;
    await writeAccounting(tx, r);
    await writePackRoles(tx, r);
    r.brands = await writeBrands(tx);
  }
  if (appEnv === "development") r.catalogUrls = await writeCatalogUrls(tx);
  return r;
}

/** 6: Group `pb-ke-toan` + 2 thành viên mỗi công ty (user vắng ⇒ bỏ qua). Cùng Group `tenant-onboard` (demo) tạo ⇒ không đụng. */
async function writeAccounting(tx: Tx, r: TenantFixtureResult): Promise<void> {
  const a = ACCOUNTING;
  r.accountingGroups = (
    await tx`insert into admin.groups (tenant_id, key, name, description)
      select tn.id, ${a.key}, ${tx.json(a.name)}, 'Phòng ban Kế toán (mẫu dev/test)'
      from admin.tenants tn where tn.key = any(${keys}::text[])
      on conflict (tenant_id, key) do nothing returning id`
  ).length;
  const map = tx.json(
    Object.entries(a.members).map(([tenant, members]) => ({ tenant, members })) as never,
  );
  r.accountingMembers = (
    await tx`insert into admin.group_members (tenant_id, group_id, user_id)
      select g.tenant_id, g.id, u.id
      from jsonb_to_recordset(${map}::jsonb) as x(tenant text, members jsonb)
      join admin.tenants tn on tn.key = x.tenant
      join admin.groups g on g.tenant_id = tn.id and g.key = ${a.key}
      join admin.users u on u.tenant_id = tn.id
        and exists (select 1 from jsonb_array_elements_text(x.members) m(v) where m.v = u.username or m.v = u.email)
      on conflict do nothing returning user_id`
  ).length;
}

/** 2: chủ quản (tenant_admin: julian.bui / demo-owner) ∈ Group `contracts-owner` + `community-owner`; evolu: user thường ∈ `*-editor`. */
async function writePackRoles(tx: Tx, r: TenantFixtureResult): Promise<void> {
  r.ownerMembers = (
    await tx`insert into admin.group_members (tenant_id, group_id, user_id)
      select g.tenant_id, g.id, u.id
      from admin.tenants tn
      join admin.groups g on g.tenant_id = tn.id and g.key = any(${[...OWNER_GROUPS]}::text[])
      join admin.users u on u.tenant_id = tn.id and u.kind = 'internal' and u.active and u.role = 'tenant_admin'
      where tn.key = any(${keys}::text[])
      on conflict do nothing returning user_id`
  ).length;
  r.editorMembers = (
    await tx`insert into admin.group_members (tenant_id, group_id, user_id)
      select g.tenant_id, g.id, u.id
      from admin.tenants tn
      join admin.groups g on g.tenant_id = tn.id and g.key = any(${[...EDITOR_GROUPS]}::text[])
      join admin.users u on u.tenant_id = tn.id and u.kind = 'internal' and u.active and u.role = 'member'
      where tn.key = any(${[...EDITOR_TENANTS]}::text[])
      on conflict do nothing returning user_id`
  ).length;
}

/** 7: company_settings (tên/tên ứng dụng/màu; logo null) — chỉ tạo hàng thiếu, không đè chỉnh sửa. Gói contracts chưa cài ⇒ bỏ qua. */
async function writeBrands(tx: Tx): Promise<number> {
  const [has] = await tx`select to_regclass('contracts.company_settings') is not null as ok`;
  if (!has?.ok) return 0;
  const rows = tx.json(BRANDS as never);
  return (
    await tx`insert into contracts.company_settings (tenant_id, company_name, app_name, accent)
      select tn.id, x.company, x.app, x.accent
      from jsonb_to_recordset(${rows}::jsonb) as x(tenant text, company text, app text, accent text)
      join admin.tenants tn on tn.key = x.tenant
      on conflict (tenant_id) do nothing returning tenant_id`
  ).length;
}

/** 4: `app_catalog.url` rỗng ⇒ cổng dev (switcher "Ứng dụng", link "Đặt trong Sổ Hợp Tác" của Agents). Chỉ appEnv=development. */
async function writeCatalogUrls(tx: Tx): Promise<number> {
  const urls = tx.json(DEV_APP_URLS as never);
  return (
    await tx`update admin.app_catalog c set url = x.url, updated_at = now()
      from jsonb_each_text(${urls}::jsonb) as x(key, url)
      where c.key = x.key and c.url = '' returning c.key`
  ).length;
}

const CliEnv = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  APP_ENV: z.enum(["development", "test", "production"]),
  HUB_SEED_FIXTURES: z.string().optional(),
});

/** CLI `bun run hub:seed:fixtures`: cùng cổng với hub:seed (HUB_SEED_FIXTURES=1 và APP_ENV ≠ production); sai cổng ⇒ không làm gì. */
export async function runTenantFixtures(
  src: Record<string, string | undefined>,
): Promise<TenantFixtureResult | null> {
  const p = CliEnv.safeParse(src);
  if (!p.success) throw new Error("Env không hợp lệ (cần DATABASE_URL, APP_ENV)");
  const fixtures = p.data.HUB_SEED_FIXTURES === "1" || p.data.HUB_SEED_FIXTURES === "true";
  if (!libSampleEnabled(p.data.APP_ENV, fixtures)) return null;
  const sql = postgres(p.data.DATABASE_URL, { max: 1, onnotice: () => {} });
  try {
    return await sql.begin((tx) => writeTenantFixtures(tx, p.data.APP_ENV));
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  try {
    const r = await runTenantFixtures(process.env);
    if (r) logger.info(`hub:seed:fixtures OK ${JSON.stringify(r)}`, { module: "seed" });
    else
      logger.info("hub:seed:fixtures bỏ qua (cần HUB_SEED_FIXTURES=1, APP_ENV≠production)", {
        module: "seed",
      });
  } catch (err) {
    logger.fatal(`hub:seed:fixtures lỗi: ${(err as Error).message}`, { module: "seed" });
    process.exit(1);
  }
}
