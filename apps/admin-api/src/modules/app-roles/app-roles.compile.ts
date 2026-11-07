// CR-112 · ADM-FR-81 · ADM-BR-15: biên dịch MỘT CHIỀU vai → feature-grant của Group của vai. Đúng 3 câu SQL bất kể số vai
// (Luật 4c): khoá vai (FOR UPDATE, thứ tự id) · xoá mã gói thừa trên CHÍNH Group của vai · chèn mã còn thiếu. Grant ngoài 3 mã
// gói và Group không phải vai (phòng ban…) không bao giờ bị đụng. Người gọi ghi sự kiện `grant` + audit mỗi thay đổi
// (`recordCompile`) ⇒ `configWrite` bump `config_version` + NOTIFY `config_changed` (vô hiệu cache quyền) sau commit.
import type { ConfigSink, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { type GrantChange, grantAudit } from "../grants/grants.service";
import { type CompileRole, compilePlan } from "./app-roles.rules";

export type CompileResult = { added: GrantChange[]; removed: GrantChange[] };

const RETURNING = sql`returning id, feature_id, group_id, user_id,
  (select x.key from admin.features x where x.id = feature_id) as feature_key,
  (select g.key from admin.groups g where g.id = group_id) as subject_name`;

/** `roleIds` null ⇒ mọi vai của tenant. */
export async function compileRoles(
  tx: Tx,
  a: { tenantId: string; roleIds: readonly string[] | null; actorId: string | null },
): Promise<CompileResult> {
  const ids = a.roleIds === null ? null : `{${a.roleIds.join(",")}}`;
  const roles = (await tx.execute(sql`select group_id, pack, level from admin.app_roles
    where tenant_id = ${a.tenantId}::uuid and (${ids}::uuid[] is null or id = any(${ids}::uuid[]))
    order by id for update`)) as unknown as CompileRole[];
  const plan = compilePlan(roles);
  const removed = (await tx.execute(sql`delete from admin.feature_grants fg
    using jsonb_to_recordset(${JSON.stringify(plan.drop)}::jsonb) as d(g uuid, f text), admin.features f
    where fg.tenant_id = ${a.tenantId}::uuid and fg.group_id = d.g and f.key = d.f and fg.feature_id = f.id
    returning fg.id, fg.feature_id, fg.group_id, fg.user_id, f.key as feature_key,
      (select g.key from admin.groups g where g.id = fg.group_id) as subject_name`)) as unknown as GrantChange[];
  const added =
    (await tx.execute(sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, granted_by)
    select ${a.tenantId}::uuid, f.id, w.g, ${a.actorId}::uuid
    from jsonb_to_recordset(${JSON.stringify(plan.want)}::jsonb) as w(g uuid, f text)
    join admin.features f on f.key = w.f
    on conflict (tenant_id, feature_id, group_id) where group_id is not null do nothing
    ${RETURNING}`)) as unknown as GrantChange[];
  return { added, removed };
}

/** Sự kiện `grant` + một dòng audit mỗi grant thật sự đổi (plan M4 §4.2). Trả số thay đổi. */
export function recordCompile(ch: ConfigSink, tenantId: string, r: CompileResult): number {
  for (const g of r.removed) ch.audit(grantAudit("revoke", tenantId, g));
  for (const g of r.added) ch.audit(grantAudit("grant", tenantId, g));
  const n = r.added.length + r.removed.length;
  if (n > 0) ch.changed({ entity: "grant", tenantId });
  return n;
}
