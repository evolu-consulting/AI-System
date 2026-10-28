// com-c12a · CR-102 · seed cộng đồng đối tác cho tenant `demo` — LẶP LẠI ĐƯỢC. Công ty ngoài + 1 user ngoài mỗi công ty, tạo qua
// CHÍNH service của admin-api (createOrg/createOrgUser: luật tên trùng, role member, must_change_password, audit, NOTIFY) — không SQL tắt.
//   bun tools/scripts/src/seed-community-demo.ts --out <file> [--tenant demo] [--apply] [--force-tenant] [--i-know-prod]
//   [--dev-fixture]  (chỉ máy dev: DB local mới ⇒ tạo tenant demo + demo-owner, mật khẩu = env DEMO_OWNER_PW)
// Mặc định chạy thử (chỉ in kế hoạch). Mật khẩu tạm CHỈ ghi vào file `--out` (BẮT BUỘC, quyền 600, không commit, không in; xoá sau
// khi dùng). Từ chối khi APP_ENV=production hoặc DB host ngoài localhost/test, trừ `--i-know-prod`.
// Cạnh đó ghi `<out>.community.json`: ánh xạ công ty → party_key Sổ Hợp Tác + nhãn/nhóm hàng (C3/C12b áp bằng applyCommunityLabels).
// DATABASE_URL: vai ứng dụng admin_api (RLS) hoặc chủ migration. KHÔNG chạy trên máy chủ production.
// com-c12b: thêm bật gói community + nhãn/nhóm hàng (partner_companies) + bài/luồng mẫu qua service của gói. Cần HUB_DATABASE_URL
// (vai hub_api, RLS gói); vắng thì dùng DATABASE_URL (chỉ chạy được khi vai đó SET ROLE được, vd chủ migration).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ExternalOrgListQuerySchema, UserListQuerySchema } from "@ai/contracts";
import { createDb, type Db, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import {
  createOrg,
  createOrgUser,
  listOrgs,
  listUsersOfOrg,
} from "../../../apps/admin-api/src/modules/external-orgs/external-orgs.service";
import type { Call } from "../../../apps/admin-api/src/modules/users/users.service";
import {
  applyLabels,
  type CommunityCtx,
  enableCommunityPack,
  seedPosts,
} from "./seed-community-demo.apply";
import { PARTNER_SEEDS, type PartnerSeed, POST_SAMPLES } from "./seed-community-demo.data";
import { devFixtureGuard, ensureDemoTenant } from "./seed-community-demo.dev-fixture";
import { seedGuard } from "./seed-community-demo.guard";
import { partyKeyOf } from "./seed-demo-v2.build";

export const DEMO_KEY = "demo";
const DEMO_OWNER_EMAIL = "demo-owner@example.invalid";

export type SeedOpts = {
  tenantKey: string;
  apply: boolean;
  forceTenant: boolean;
  out: string;
  /** Pool vai hub_api (RLS gói). Vắng ⇒ dùng `db`. */
  hubDb?: Db;
  log?: (s: string) => void;
};
export type SeedResult = {
  orgs: { created: number; existing: number };
  users: { created: number; existing: number };
  mapFile: string | null;
  passwordsFile: string | null;
  posts: { created: number; existing: number; comments: number };
};
export type MapRow = {
  org_id: string;
  org_name: string;
  party_key: string | null;
  labels: readonly string[];
  categories: readonly string[];
};

/** Chặn cứng: chỉ `demo`, trừ khi `--force-tenant` (dùng cho DB test). */
export function assertTenant(key: string, force: boolean): void {
  if (key !== DEMO_KEY && !force)
    throw new Error(
      `seed-community-demo: từ chối tenant "${key}" — chỉ "${DEMO_KEY}" (thêm --force-tenant nếu chắc chắn)`,
    );
}

/** Tenant + admin thực hiện (demo-owner, hoặc tenant_admin active đầu tiên) — đọc theo scope platform. */
async function resolveCall(db: Db, tenantKey: string): Promise<Call> {
  const r = await withScope(db, { kind: "platform" }, async (tx) => {
    const [t] = (await tx.execute(
      sql`select id from admin.tenants where key = ${tenantKey}`,
    )) as unknown as { id: string }[];
    if (!t) return null;
    const [u] = (await tx.execute(sql`select id from admin.users
      where tenant_id = ${t.id} and kind = 'internal' and role = 'tenant_admin' and active
      order by (email = ${DEMO_OWNER_EMAIL}) desc, created_at, id limit 1`)) as unknown as {
      id: string;
    }[];
    return { tenantId: t.id, userId: u?.id };
  });
  if (!r) throw new Error(`seed-community-demo: không có tenant "${tenantKey}"`);
  if (!r.userId) throw new Error(`seed-community-demo: tenant "${tenantKey}" chưa có tenant_admin`);
  return {
    ctx: { db },
    actor: { userId: r.userId, tenantId: r.tenantId, role: "tenant_admin" },
    scope: { kind: "tenant", tenantId: r.tenantId },
  };
}

const partyKey = (p: PartnerSeed): string | null => (p.sht ? partyKeyOf(p.sht) : null);

/** Ghi nhãn (supplier/buyer) + nhóm hàng + liên kết SHT vào `community.partner_companies` (một tx, upsert). */
export function applyCommunityLabels(c: CommunityCtx, rows: readonly MapRow[]): Promise<number> {
  return applyLabels(c, rows);
}

async function findOrgId(c: Call, name: string): Promise<{ id: string; active: boolean } | null> {
  const q = ExternalOrgListQuerySchema.parse({ q: name });
  const { items } = await listOrgs(c, q);
  const o = items.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return o ? { id: o.id, active: o.active } : null;
}

async function ensureOrg(c: Call, p: PartnerSeed): Promise<{ id: string; created: boolean }> {
  const found = await findOrgId(c, p.name);
  if (found) {
    if (!found.active) throw new Error(`seed-community-demo: công ty "${p.name}" đã bị vô hiệu`);
    return { id: found.id, created: false };
  }
  return { id: (await createOrg(c, undefined, { name: p.name })).id, created: true };
}

/** Mật khẩu tạm chỉ trả về cho user MỚI; user đã có thì giữ nguyên (không reset). */
async function ensureUser(
  c: Call,
  orgId: string,
  p: PartnerSeed,
): Promise<{ id: string; temp: string | null }> {
  const { items } = await listUsersOfOrg(c, orgId, UserListQuerySchema.parse({}));
  const had = items.find((u) => u.username === p.username);
  if (had) return { id: had.id, temp: null };
  const r = await createOrgUser(c, orgId, {
    username: p.username,
    display_name: p.displayName,
    locale: "vi",
  });
  return { id: r.user.id, temp: r.temp_password };
}

function planLines(tenantKey: string): string[] {
  const head = `seed-community-demo: chạy thử — tenant "${tenantKey}", ${PARTNER_SEEDS.length} công ty (thêm --apply để ghi)`;
  return [
    head,
    "  - bật gói community cho tenant (service admin enablePack)",
    ...PARTNER_SEEDS.map(
      (p) =>
        `  - ${p.name} [${p.labels.join("+")}] user ${p.username} · SHT ${partyKey(p) ?? "(chưa có)"} · ${p.categories.join(", ")}`,
    ),
    ...POST_SAMPLES.map(
      (p) =>
        `  - bài ${p.type} "${p.title}" · ${p.by}${p.replies ? ` · ${p.replies.length} bình luận` : ""}`,
    ),
  ];
}

function writeOut(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  // `mode` chỉ áp khi TẠO file — file cũ (lần chạy trước) phải đặt lại quyền hẹp (review TB-3). Windows: chmod chỉ đổi cờ chỉ-đọc.
  try {
    chmodSync(file, 0o600);
  } catch {
    /* hệ tệp không hỗ trợ quyền POSIX */
  }
}

/** Gộp với file cũ (lần chạy trước) để không mất mật khẩu của user đã tạo; không có user mới ⇒ null. */
function writePasswords(o: SeedOpts, pw: Record<string, string>): string | null {
  if (Object.keys(pw).length === 0) return null;
  const prev = existsSync(o.out)
    ? (JSON.parse(readFileSync(o.out, "utf8")) as { users?: Record<string, string> })
    : {};
  writeOut(o.out, { tenant: o.tenantKey, users: { ...prev.users, ...pw } });
  return o.out;
}

export async function runSeed(db: Db, o: SeedOpts): Promise<SeedResult> {
  const log = o.log ?? console.log;
  assertTenant(o.tenantKey, o.forceTenant);
  const res: SeedResult = {
    orgs: { created: 0, existing: 0 },
    users: { created: 0, existing: 0 },
    mapFile: null,
    passwordsFile: null,
    posts: { created: 0, existing: 0, comments: 0 },
  };
  if (!o.apply) {
    for (const l of planLines(o.tenantKey)) log(l);
    return res;
  }
  const c = await resolveCall(db, o.tenantKey);
  const rows: MapRow[] = [];
  const pw: Record<string, string> = {};
  const partners = new Map<string, { userId: string; orgId: string; orgName: string }>();
  for (const p of PARTNER_SEEDS) {
    const org = await ensureOrg(c, p);
    res.orgs[org.created ? "created" : "existing"] += 1;
    const { id: userId, temp } = await ensureUser(c, org.id, p);
    if (temp) pw[p.username] = temp;
    res.users[temp ? "created" : "existing"] += 1;
    partners.set(p.username, { userId, orgId: org.id, orgName: p.name });
    rows.push({
      org_id: org.id,
      org_name: p.name,
      party_key: partyKey(p),
      labels: p.labels,
      categories: p.categories,
    });
  }
  res.mapFile = `${o.out}.community.json`;
  writeOut(res.mapFile, { tenant: o.tenantKey, partners: rows });
  res.passwordsFile = writePasswords(o, pw);
  await enableCommunityPack(db, c.actor.tenantId, c.actor.userId);
  const cc: CommunityCtx = {
    hub: o.hubDb ?? db,
    admin: db,
    tenantId: c.actor.tenantId,
    hostUserId: c.actor.userId,
    partners,
  };
  await applyCommunityLabels(cc, rows);
  const pr = await seedPosts(cc);
  res.posts = {
    created: pr.postsCreated,
    existing: pr.postsExisting,
    comments: pr.commentsCreated,
  };
  log(
    `seed-community-demo: bài +${pr.postsCreated}/=${pr.postsExisting}, bình luận +${pr.commentsCreated}; công ty +${res.orgs.created}/=${res.orgs.existing}, user +${res.users.created}/=${res.users.existing}; mật khẩu: ${res.passwordsFile ?? "(không có user mới)"}; ánh xạ: ${res.mapFile}`,
  );
  return res;
}

/** `--dev-fixture` (máy dev): tạo tenant demo + demo-owner nếu chưa có — để seed chạy được trên DB local mới. */
async function devFixture(db: Db, urls: readonly string[], o: SeedOpts): Promise<void> {
  const ownerPw = process.env.DEMO_OWNER_PW;
  const why = devFixtureGuard({ appEnv: process.env.APP_ENV, urls, ownerPw });
  if (why) throw new Error(`seed-community-demo: từ chối — ${why}`);
  if (o.tenantKey !== DEMO_KEY)
    throw new Error("seed-community-demo: --dev-fixture chỉ cho tenant demo");
  if (!o.apply) return console.log("  - (dev-fixture) tạo tenant demo + demo-owner nếu chưa có");
  const r = await ensureDemoTenant(db, ownerPw as string);
  console.log(`seed-community-demo: dev-fixture tenant ${r.tenant}, demo-owner ${r.owner}`);
}

async function main(argv: readonly string[]): Promise<void> {
  const arg = (k: string) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("seed-community-demo: cần DATABASE_URL");
  const hubUrl = process.env.HUB_DATABASE_URL;
  const out = arg("--out");
  const why = seedGuard({
    appEnv: process.env.APP_ENV,
    urls: hubUrl ? [url, hubUrl] : [url],
    iKnowProd: argv.includes("--i-know-prod"),
    out,
  });
  if (why) throw new Error(`seed-community-demo: từ chối — ${why}`);
  const opts: SeedOpts = {
    tenantKey: arg("--tenant") ?? DEMO_KEY,
    apply: argv.includes("--apply"),
    forceTenant: argv.includes("--force-tenant"),
    out: out as string,
  };
  assertTenant(opts.tenantKey, opts.forceTenant);
  const db = createDb(url, { max: 2 });
  const hubDb = hubUrl ? createDb(hubUrl, { max: 2 }) : undefined;
  try {
    if (argv.includes("--dev-fixture")) await devFixture(db, hubUrl ? [url, hubUrl] : [url], opts);
    const r = await runSeed(db, { ...opts, hubDb });
    if (r.passwordsFile)
      console.warn(
        `seed-community-demo: CẢNH BÁO — ${r.passwordsFile} chứa mật khẩu tạm; phát cho đối tác rồi XOÁ file ngay.`,
      );
  } finally {
    await hubDb?.close();
    await db.close();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(1);
  });
