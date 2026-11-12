// com-fix-community-login · fixture CHỈ MÁY DEV cho `seed-community-demo --dev-fixture`: DB local mới tạo chưa có tenant `demo`
// + chủ quản `demo-owner` (tenant_admin, email demo-owner@example.invalid) ⇒ tạo (idempotent, không đổi user đã có). Mật khẩu chủ
// quản lấy từ env `DEMO_OWNER_PW` (không in, không ghi file). Từ chối khi APP_ENV ≠ development|test hoặc DB host ngoài loopback/*.localhost/*.test —
// KHÔNG có cờ vượt (khác seed chính có `--i-know-prod`): production đã có tenant demo thật.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts/common";
import { type Db, hashPassword, withConfigWrite, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { publishConfigChanged } from "../../../apps/admin-api/src/lib/config/config-write";
import { membersAudit } from "../../../apps/admin-api/src/modules/groups/groups.service";
import { enablePack } from "../../../apps/admin-api/src/modules/packs/packs.service";

export const DEMO_TENANT = { key: "demo", name: "Demo Sổ Hợp Tác" } as const;
export const DEMO_OWNER = {
  username: "demo-owner",
  email: "demo-owner@example.invalid",
  displayName: "Nguyễn Văn An",
} as const;

/** Host DB của fixture: CHỈ loopback, `*.localhost`, `*.test` — chặt hơn seed chính (không nhận tên dịch vụ `postgres`/`db`). */
export function isDevFixtureHost(url: string): boolean {
  let h: string;
  try {
    h = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return (
    ["localhost", "127.0.0.1", "::1"].includes(h) || h.endsWith(".localhost") || h.endsWith(".test")
  );
}

/** Lý do TỪ CHỐI tạo fixture (null = được). Thuần. Cần APP_ENV development|test VÀ host dev. */
export function devFixtureGuard(o: {
  appEnv: string | undefined;
  urls: readonly string[];
  ownerPw: string | undefined;
}): string | null {
  if (o.appEnv !== "development" && o.appEnv !== "test")
    return `--dev-fixture chỉ cho máy dev (APP_ENV=${o.appEnv ?? "(vắng)"}, cần development|test)`;
  if (o.urls.some((u) => !isDevFixtureHost(u)))
    return "--dev-fixture chỉ cho DB localhost/test (không có cờ vượt)";
  const n = o.ownerPw?.length ?? 0;
  if (n < PASSWORD_MIN_LEN || n > PASSWORD_MAX_LEN)
    return `--dev-fixture cần DEMO_OWNER_PW (${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} ký tự)`;
  return null;
}

type Outcome = "created" | "exists";

/** Tenant `demo` + `demo-owner` (scope platform, một transaction). Đã có ⇒ giữ nguyên (không reset mật khẩu). */
export async function ensureDemoTenant(
  db: Db,
  ownerPw: string,
): Promise<{ tenant: Outcome; owner: Outcome }> {
  const hash = await hashPassword(ownerPw);
  return withScope(db, { kind: "platform" }, async (tx) => {
    const ins = (await tx.execute(sql`insert into admin.tenants (id, key, name)
      values (${Bun.randomUUIDv7()}, ${DEMO_TENANT.key}, ${DEMO_TENANT.name})
      on conflict (key) do nothing returning id`)) as unknown as { id: string }[];
    const [t] = ins.length
      ? ins
      : ((await tx.execute(
          sql`select id from admin.tenants where key = ${DEMO_TENANT.key}`,
        )) as unknown as { id: string }[]);
    if (!t) throw new Error("dev-fixture: không đọc được tenant demo");
    const u = (await tx.execute(sql`insert into admin.users
      (id, tenant_id, username, password_hash, display_name, email, role, locale, must_change_password)
      values (${Bun.randomUUIDv7()}, ${t.id}, ${DEMO_OWNER.username}, ${hash}, ${DEMO_OWNER.displayName},
              ${DEMO_OWNER.email}, 'tenant_admin', 'vi', false)
      on conflict (tenant_id, username) do nothing returning id`)) as unknown as { id: string }[];
    return { tenant: ins.length ? "created" : "exists", owner: u.length ? "created" : "exists" };
  });
}

/** Tiền tố username đối tác của seed cộng đồng (`PARTNER_SEEDS`: doitac-tanphat…). */
const PARTNER_PREFIX = "doitac-";

/**
 * seed-refresh · CHỈ dev-fixture: user đối tác của tenant demo dùng mật khẩu dev đã biết (= `DEMO_OWNER_PW` của máy này, không
 * bao giờ mật khẩu thật) và không bị bắt đổi ở lần đăng nhập đầu — đăng nhập cổng đối tác ngay, không cần file mật khẩu tạm.
 * Chỉ đổi user `kind='external'` có tiền tố doitac- của tenant demo; trả số user đã đặt lại.
 */
export async function setPartnerDevPasswords(
  db: Db,
  pw: string,
  tenantKey: string = DEMO_TENANT.key,
): Promise<number> {
  const hash = await hashPassword(pw);
  return withScope(db, { kind: "platform" }, async (tx) => {
    const r =
      (await tx.execute(sql`update admin.users u set password_hash = ${hash}, must_change_password = false
      from admin.tenants t where t.id = u.tenant_id and t.key = ${tenantKey} and u.kind = 'external'
        and u.username like ${`${PARTNER_PREFIX}%`} returning u.id`)) as unknown as unknown[];
    return r.length;
  });
}

/** Group gói giữ quyền chủ quản đầy đủ (do `enablePack` tạo). */
export const OWNER_GROUP = "contracts-owner";

/**
 * Sau `enablePack`: demo-owner vào Group `contracts-owner` (nội bộ vào gói theo Group — thiếu thì 403 PACK_FORBIDDEN). Như
 * tenant-owner-setup: một configWrite (audit + config_changed để Hub nạp lại). Đã là thành viên ⇒ không đổi.
 */
export async function ensureOwnerInGroup(db: Db): Promise<"added" | "exists"> {
  const [r] = await withScope(
    db,
    { kind: "platform" },
    async (tx) =>
      (await tx.execute(sql`select t.id as tid, u.id as uid, g.id as gid,
        exists (select 1 from admin.group_members m where m.group_id = g.id and m.user_id = u.id) as member
      from admin.tenants t
      join admin.users u on u.tenant_id = t.id and u.username = ${DEMO_OWNER.username}
      join admin.groups g on g.tenant_id = t.id and g.key = ${OWNER_GROUP}
      where t.key = ${DEMO_TENANT.key}`)) as unknown as {
        tid: string;
        uid: string;
        gid: string;
        member: boolean;
      }[],
  );
  if (!r)
    throw new Error(
      `dev-fixture: thiếu demo-owner hoặc Group ${OWNER_GROUP} (gói contracts chưa bật?)`,
    );
  if (r.member) return "exists";
  // Actor audit = HỆ THỐNG (actor_id null, như audit của bộ giới hạn đăng nhập) — không ghi demo-owner tự thêm mình.
  const w = await withConfigWrite(
    db,
    { kind: "platform" },
    async (tx, ch) => {
      await tx.execute(sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
        values (${r.tid}::uuid, ${r.gid}::uuid, ${r.uid}::uuid, null) on conflict do nothing`);
      ch.changed({ entity: "group", tenantId: r.tid });
      ch.audit(
        membersAudit(
          { id: r.gid, tenantId: r.tid, key: OWNER_GROUP },
          { added: [DEMO_OWNER.username] },
        ),
      );
    },
    { actorId: null },
  );
  if (w.version !== null) await publishConfigChanged(db, w.version, w.events);
  return "added";
}

/**
 * CR-118: bật gói `contracts` cho tenant demo (stack e2e web gộp: `/pack/me` của demo-owner phải có `apps` ⊇ contracts, nếu không
 * web đưa về /community). enablePack tạo Group contracts-owner/editor; demo-owner vào nhóm ở bước `seed.tenant-fixtures` sau đó.
 */
export async function ensureContractsPack(db: Db): Promise<"enabled"> {
  const [r] = await withScope(
    db,
    { kind: "platform" },
    async (tx) =>
      (await tx.execute(sql`select t.id as tid, u.id as uid from admin.tenants t
        join admin.users u on u.tenant_id = t.id and u.username = ${DEMO_OWNER.username}
        where t.key = ${DEMO_TENANT.key}`)) as unknown as { tid: string; uid: string }[],
  );
  if (!r) throw new Error("dev-fixture: thiếu tenant demo / demo-owner");
  await enablePack(
    { ctx: { db }, scope: { kind: "platform" }, actor: { userId: r.uid } },
    r.tid,
    "contracts",
  );
  return "enabled";
}
