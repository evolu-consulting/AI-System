// tenant-owner · tạo CHỦ ĐẦU TIÊN của một tenant (tenant_admin, KHÔNG email, locale vi, bắt đổi mật khẩu) qua đường tạo user của
// nền tảng (`createFirstAdmin` + `hashPassword` + `configWrite` scope platform, role admin_api — RLS bật). Không gửi mail/thông báo:
// `notifier` không bao giờ được gọi (test có spy). Mật khẩu 24 ký tự chỉ ghi vào file `--out` (mode 600), không in.
// Thêm vào Group giữ `contracts-admin` + trưởng phòng "Phòng Giám đốc" (nếu có). User đã có ⇒ "exists, nothing to do".
// Mặc định chạy thử; `--apply` mới ghi. Trên máy chủ (env có ADMIN_API_DATABASE_URL):
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/tenant-owner-setup.ts \
//     --tenant <key> --name "<họ tên>" --username <u> [--apply] [--out /claude-home/TENANT_OWNER_<key>.txt]
import { randomBytes } from "node:crypto";
import { chmod, rm, writeFile } from "node:fs/promises";
import { createDb, type Db, hashPassword, type Tx, withScope } from "@ai/db";
import { sql } from "drizzle-orm";
import { auditOf } from "../../../apps/admin-api/src/lib/audit/audit.write";
import { type ConfigSink, configWrite } from "../../../apps/admin-api/src/lib/config/config-write";
import { generateTempPassword } from "../../../apps/admin-api/src/modules/auth/auth.rules";
import { membersAudit } from "../../../apps/admin-api/src/modules/groups/groups.service";
import {
  createFirstAdmin,
  userAudit,
} from "../../../apps/admin-api/src/modules/users/users.service";
import {
  credentialsText,
  describeOwnerPlan,
  normName,
  OWNER_PASSWORD_LEN,
  type OwnerArgs,
  type OwnerPlan,
  parseOwnerArgs,
  TOP_DEPARTMENT,
} from "./tenant-owner-setup.rules";

/** Cổng thông báo (mail…). Script KHÔNG BAO GIỜ gọi; bản chạy thật ném nếu bị gọi. */
export type Notifier = { send(m: unknown): Promise<void> };
export type OwnerDeps = { db: Db; notifier: Notifier; random?: (n: number) => Uint8Array };
export type OwnerResult = { plan: OwnerPlan; created: boolean; userId?: string };

const PLATFORM = { kind: "platform" } as const;
const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T[]> =>
  (await tx.execute(q)) as unknown as T[];

async function tenantAndUser(tx: Tx, a: OwnerArgs) {
  const [t] = await rows<{ id: string; exists: boolean }>(
    tx,
    sql`select t.id, exists (select 1 from admin.users u where u.tenant_id = t.id and u.username = ${a.username}) as exists
      from admin.tenants t where t.key = ${a.tenant}`,
  );
  if (!t) throw new Error(`tenant-owner-setup: không có tenant "${a.tenant}"`);
  return t;
}

async function lookups(tx: Tx, tenantId: string) {
  const [actor] = await rows<{ id: string; username: string }>(
    tx,
    sql`select u.id, u.username from admin.users u join admin.tenants t on t.id = u.tenant_id
      where t.key = 'platform' and u.role = 'platform_admin' and u.active order by u.created_at, u.id limit 1`,
  );
  const [group] = await rows<{ id: string; key: string }>(
    tx,
    sql`select g.id, g.key from admin.groups g
      where g.tenant_id = ${tenantId}::uuid and exists (select 1 from admin.feature_grants x
        join admin.features f on f.id = x.feature_id where x.tenant_id = g.tenant_id and x.group_id = g.id
          and f.key = 'contracts-admin')
      order by (g.key = 'contracts-owner') desc, g.key limit 1`,
  );
  const depts = await rows<{
    groupId: string;
    key: string;
    name: string;
    root: boolean;
    prevHead: string | null;
  }>(
    tx,
    sql`select d.group_id as "groupId", g.key, coalesce(g.name ->> 'vi', g.key) as name,
        d.parent_group_id is null as root, h.username as "prevHead"
      from admin.departments d join admin.groups g on g.id = d.group_id and g.tenant_id = d.tenant_id
      left join admin.users h on h.id = d.head_user_id
      where d.tenant_id = ${tenantId}::uuid order by root desc, d.sort_order nulls last, g.key`,
  );
  const top = depts.find((d) => normName(d.name) === normName(TOP_DEPARTMENT));
  return {
    actor,
    group,
    dept: top ? { groupId: top.groupId, key: top.key, prevHead: top.prevHead } : null,
  };
}

/** Đọc hiện trạng (scope platform) ⇒ kế hoạch. Thiếu platform admin / Group contracts-admin ⇒ ném lý do rõ. */
export async function planOwner(tx: Tx, a: OwnerArgs): Promise<OwnerPlan> {
  const t = await tenantAndUser(tx, a);
  if (t.exists) return { kind: "exists" };
  const { actor, group, dept } = await lookups(tx, t.id);
  if (!actor)
    throw new Error("tenant-owner-setup: không có platform_admin đang hoạt động (người ghi audit)");
  if (!group)
    throw new Error(
      `tenant-owner-setup: tenant "${a.tenant}" chưa có Group giữ contracts-admin (bật gói contracts trước)`,
    );
  return { kind: "create", tenantId: t.id, actor, group, dept };
}

type Create = Extract<OwnerPlan, { kind: "create" }>;

/** Một transaction: user (đường tạo user nền tảng) + thành viên Group + trưởng phòng; audit + config_changed như API. */
async function applyOwner(db: Db, a: OwnerArgs, p: Create, hash: string): Promise<string> {
  const call = { ctx: { db }, scope: PLATFORM, actor: { userId: p.actor.id } };
  return configWrite(call, "user.save", async (tx, ch) => {
    await rows(tx, sql`select id from admin.tenants where id = ${p.tenantId}::uuid for share`);
    const input = {
      tenantId: p.tenantId,
      username: a.username,
      displayName: a.name,
      email: null,
      locale: "vi" as const,
    };
    const user = await createFirstAdmin(tx, input, hash, p.actor.id);
    ch.changed({ entity: "user", tenantId: p.tenantId });
    ch.audit(userAudit("create", null, user, { tenant_owner: true }));
    await rows(
      tx,
      sql`insert into admin.group_members (tenant_id, group_id, user_id, added_by)
        values (${p.tenantId}::uuid, ${p.group.id}::uuid, ${user.id}::uuid, ${p.actor.id}::uuid) on conflict do nothing`,
    );
    ch.changed({ entity: "group", tenantId: p.tenantId });
    ch.audit(
      membersAudit(
        { id: p.group.id, tenantId: p.tenantId, key: p.group.key },
        { added: [a.username] },
      ),
    );
    if (p.dept) await setHead(tx, ch, p, p.dept, user.id);
    return user.id;
  });
}

async function setHead(
  tx: Tx,
  ch: ConfigSink,
  p: Create,
  d: NonNullable<Create["dept"]>,
  userId: string,
): Promise<void> {
  await rows(
    tx,
    sql`update admin.departments set head_user_id = ${userId}::uuid, updated_at = now()
      where group_id = ${d.groupId}::uuid and tenant_id = ${p.tenantId}::uuid`,
  );
  const target = {
    entityId: d.groupId,
    entityName: d.key,
    tenantId: p.tenantId,
    before: null,
    after: null,
  };
  ch.audit(
    auditOf("update", "group", { ...target, summary: { department: { head_user_id: userId } } }),
  );
}

/** Ghi file thông tin đăng nhập, mode 600 (cả khi file đã có). */
async function writeSecret(path: string, text: string): Promise<void> {
  await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

/**
 * Chạy thử ⇒ chỉ kế hoạch. `--apply`: băm ngoài transaction, ghi file TRƯỚC commit (commit hỏng ⇒ xoá file), rồi một transaction.
 * Trùng username lúc ghi (đua) ⇒ coi như "exists". `deps.notifier` không bao giờ được gọi.
 */
export async function runOwnerSetup(deps: OwnerDeps, a: OwnerArgs): Promise<OwnerResult> {
  const plan = await withScope(deps.db, PLATFORM, (tx) => planOwner(tx, a));
  if (plan.kind === "exists" || !a.apply) return { plan, created: false };
  const pw = generateTempPassword(deps.random ?? ((n) => randomBytes(n)), OWNER_PASSWORD_LEN);
  const hash = await hashPassword(pw);
  await writeSecret(a.out, credentialsText(a, pw));
  try {
    return { plan, created: true, userId: await applyOwner(deps.db, a, plan, hash) };
  } catch (err) {
    await rm(a.out, { force: true });
    if ((err as { code?: string }).code === "USERNAME_TAKEN")
      return { plan: { kind: "exists" }, created: false };
    throw err;
  }
}

const NEVER: Notifier = {
  async send() {
    throw new Error("tenant-owner-setup: tenant này không bao giờ nhận thông báo");
  },
};

async function main(argv: readonly string[]): Promise<void> {
  const a = parseOwnerArgs(argv);
  const url = process.env.ADMIN_API_DATABASE_URL;
  if (!url) throw new Error("tenant-owner-setup: cần ADMIN_API_DATABASE_URL (role admin_api)");
  const db = createDb(url, { max: 2 });
  try {
    const r = await runOwnerSetup({ db, notifier: NEVER }, a);
    const head =
      r.plan.kind === "exists"
        ? ""
        : a.apply
          ? "ĐÃ ÁP DỤNG — "
          : "chạy thử (thêm --apply để ghi) — ";
    console.log(`tenant-owner-setup[${a.tenant}]: ${head}${r.created ? `user ${r.userId}` : ""}`);
    for (const s of describeOwnerPlan(r.plan, a)) console.log(`  - ${s}`);
  } finally {
    await db.close();
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((e) => {
    console.error((e as Error).message);
    process.exit(1);
  });
