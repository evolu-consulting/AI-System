// com-fix-community-login · fixture CHỈ MÁY DEV cho `seed-community-demo --dev-fixture`: DB local mới tạo chưa có tenant `demo`
// + chủ quản `demo-owner` (tenant_admin, email demo-owner@example.invalid) ⇒ tạo (idempotent, không đổi user đã có). Mật khẩu chủ
// quản lấy từ env `DEMO_OWNER_PW` (không in, không ghi file). Từ chối khi APP_ENV=production hoặc DB host ngoài localhost/test —
// KHÔNG có cờ vượt (khác seed chính có `--i-know-prod`): production đã có tenant demo thật.
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN } from "@ai/contracts";
import { type Db, hashPassword, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { configWrite } from "../../../apps/admin-api/src/lib/config/config-write";
import { membersAudit } from "../../../apps/admin-api/src/modules/groups/groups.service";
import { isLocalDbHost } from "./seed-community-demo.guard";

export const DEMO_TENANT = { key: "demo", name: "Demo Sổ Hợp Tác" } as const;
export const DEMO_OWNER = {
  username: "demo-owner",
  email: "demo-owner@example.invalid",
  displayName: "Nguyễn Văn An",
} as const;

/** Lý do TỪ CHỐI tạo fixture (null = được). Thuần. */
export function devFixtureGuard(o: {
  appEnv: string | undefined;
  urls: readonly string[];
  ownerPw: string | undefined;
}): string | null {
  if (o.appEnv === "production") return "--dev-fixture chỉ cho máy dev (APP_ENV=production)";
  if (o.urls.some((u) => !isLocalDbHost(u)))
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

/** Group gói giữ quyền chủ quản đầy đủ (do `enablePack` tạo). */
export const OWNER_GROUP = "community-owner";

/**
 * Sau `enablePack`: demo-owner vào Group `community-owner` (nội bộ vào gói theo Group — thiếu thì 403 PACK_FORBIDDEN). Như
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
      `dev-fixture: thiếu demo-owner hoặc Group ${OWNER_GROUP} (gói community chưa bật?)`,
    );
  if (r.member) return "exists";
  const call = { ctx: { db }, scope: { kind: "platform" as const }, actor: { userId: r.uid } };
  await configWrite(call, "group.members", async (tx, ch) => {
    await tx.execute(sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
      values (${r.tid}::uuid, ${r.gid}::uuid, ${r.uid}::uuid, ${r.uid}::uuid) on conflict do nothing`);
    ch.changed({ entity: "group", tenantId: r.tid });
    ch.audit(
      membersAudit(
        { id: r.gid, tenantId: r.tid, key: OWNER_GROUP },
        { added: [DEMO_OWNER.username] },
      ),
    );
  });
  return "added";
}
