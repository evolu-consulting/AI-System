// CR-189 · phần dùng chung của org.service (đọc/quản lý/chức vụ/đổi cha) và org-dept.* (sửa cơ cấu trên sơ đồ):
// OrgCall, tenant của lời gọi, KHOÁ cơ cấu theo công ty, kiểm tên phòng không trùng cùng cấp, sinh key Group từ tên.
import type { Db, DbScope, Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { appError } from "../../lib/errors";
import type { TestHooks } from "../../lib/test-hooks";
import { type Actor, resolveTenantScope } from "../users/users.rules";

export type OrgCall = { ctx: { db: Db; hooks?: TestHooks }; actor: Actor; scope: DbScope };

export function tenantOf(c: OrgCall, q: string | undefined, op: "read" | "write"): string {
  const r = resolveTenantScope(c.actor, q, op);
  if ("code" in r) throw appError(r.code);
  if (r.tenantId === null) throw appError("TENANT_REQUIRED");
  return r.tenantId;
}

/**
 * THỨ TỰ KHOÁ cố định cho mọi thao tác sửa cơ cấu (để hai thao tác đồng thời không vỡ/không deadlock):
 *   1) advisory `org-dept:<tenant>` (hàm này, luôn ĐẦU TIÊN, trước mọi khoá hàng) — tuần tự hoá cả cây của công ty;
 *   2) hàng `admin.groups` liên quan (phòng đích + phòng cha) theo `id` TĂNG (một câu `order by id for …`);
 *   3) hàng `admin.group_members` theo (group_id, user_id) TĂNG; 4) `config_meta` (configWrite bump, cuối cùng).
 */
export async function lockOrgTree(tx: Tx, t: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`org-dept:${t}`}))`);
}

/** Tên phòng đã có ở cùng phòng cha (không phân hoa/thường; `except` = chính phòng đang sửa) ⇒ 409 `NAME_TAKEN`. */
export async function assertNameFree(
  tx: Tx,
  t: string,
  at: { name: string; parent: string | null; except: string | null },
): Promise<void> {
  const { name, parent, except } = at;
  const r = (await tx.execute(sql`select 1 from admin.departments d
    join admin.groups g on g.id = d.group_id and g.tenant_id = d.tenant_id
    where d.tenant_id = ${t}::uuid and d.parent_group_id is not distinct from ${parent}::uuid
      and lower(btrim(g.name ->> 'vi')) = lower(btrim(${name}::text))
      and (${except}::uuid is null or d.group_id <> ${except}::uuid) limit 1`)) as unknown as unknown[];
  if (r.length > 0) throw appError("NAME_TAKEN");
}

/** Key Group (`^[a-z0-9-]{2,32}$`) từ tên: bỏ dấu, thường, gạch nối; `taken` = các key đã có ⇒ thêm hậu tố `-2`, `-3`… */
export function groupKeyOf(name: string, taken: ReadonlySet<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24)
      .replace(/-+$/g, "") || "phong";
  const first = base.length >= 2 ? base : `${base}-1`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const k = `${first}-${n}`;
    if (!taken.has(k)) return k;
  }
}
