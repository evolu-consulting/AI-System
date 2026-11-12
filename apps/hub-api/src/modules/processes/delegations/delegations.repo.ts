// CR-127 · E3 · spec §5.2 · R#43 · repo `hub.delegations` (RLS tenant; "ai xem" lọc trong câu đọc). Huỷ = `revoked_at` (không DELETE).
// Mỗi hàm một câu SQL cố định; tên người đọc cùng câu.
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { DelegationKind, DelegationRow } from "../domain/tasks/delegation.rules";

type Row = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_at: Date | string;
  to_at: Date | string;
  kinds: DelegationKind[];
  created_by: string;
  revoked_at: Date | string | null;
  from_name: string;
  to_name: string;
  by_name: string;
};
export type DelegationView = DelegationRow & {
  id: string;
  createdBy: string;
  names: { from: string; to: string; by: string };
};

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));
const nm = (col: string) =>
  sql.raw(`(select coalesce(nullif(u.display_name, ''), u.username) from admin.users u
    where u.id = ${col} and u.tenant_id = d.tenant_id)`);
const SELECT = sql`select d.id, d.from_user_id, d.to_user_id, d.from_at, d.to_at, d.kinds, d.created_by, d.revoked_at,
  ${nm("d.from_user_id")} as from_name, ${nm("d.to_user_id")} as to_name, ${nm("d.created_by")} as by_name
  from hub.delegations d`;

function view(r: Row): DelegationView {
  return {
    id: r.id,
    fromUserId: r.from_user_id,
    toUserId: r.to_user_id,
    fromAt: toDate(r.from_at),
    toAt: toDate(r.to_at),
    kinds: r.kinds,
    revokedAt: r.revoked_at === null ? null : toDate(r.revoked_at),
    createdBy: r.created_by,
    names: {
      from: r.from_name ?? r.from_user_id,
      to: r.to_name ?? r.to_user_id,
      by: r.by_name ?? r.created_by,
    },
  };
}

/** Trưởng phòng (các phòng) mà `userId` là thành viên — R#43 / đặt thay. */
const headsOf = (tenant: string, user: SQL) =>
  sql`array(select dp.head_user_id::text from admin.departments dp
    join admin.group_members gm on gm.group_id = dp.group_id and gm.tenant_id = dp.tenant_id
    where dp.tenant_id = ${tenant}::uuid and gm.user_id = ${user} and dp.head_user_id is not null)`;

/**
 * Danh sách người xem được (R#43): bản thân from/to ∪ quản trị (`all`) ∪ trưởng phòng của người uỷ quyền. `mine` ⇒ chỉ from/to là mình.
 * Mới nhất trước, ≤ 200.
 */
export async function listDelegations(
  tx: Tx,
  a: { tenantId: string; viewerId: string; all: boolean; mine: boolean },
): Promise<DelegationView[]> {
  const rows = await tx.execute<Row>(sql`${SELECT}
    where d.tenant_id = ${a.tenantId}::uuid and (
      d.from_user_id = ${a.viewerId}::uuid or d.to_user_id = ${a.viewerId}::uuid
      or (not ${a.mine} and (${a.all} or ${a.viewerId}::text = any(${headsOf(a.tenantId, sql.raw("d.from_user_id"))}))))
    order by d.created_at desc, d.id limit 200`);
  return rows.map(view);
}

export async function getDelegation(
  tx: Tx,
  tenantId: string,
  id: string,
): Promise<DelegationView | null> {
  const [r] = await tx.execute<Row>(
    sql`${SELECT} where d.id = ${id}::uuid and d.tenant_id = ${tenantId}::uuid`,
  );
  return r ? view(r) : null;
}

export type CreateCtx = {
  headsOfFrom: string[];
  existing: DelegationRow[];
  /** B và A cùng công ty, còn hoạt động. */
  usersOk: boolean;
};

/** MỘT câu: bối cảnh kiểm khi lưu — trưởng phòng của A, uỷ quyền chưa huỷ chạm A hoặc B, A/B hợp lệ. */
export async function createCtx(
  tx: Tx,
  a: { tenantId: string; fromUserId: string; toUserId: string },
): Promise<CreateCtx> {
  const [r] = await tx.execute<{
    heads: string[] | null;
    existing: Row[] | string | null;
    ok: boolean;
  }>(sql`
    select ${headsOf(a.tenantId, sql`${a.fromUserId}::uuid`)} as heads,
      (select coalesce(jsonb_agg(jsonb_build_object('from_user_id', d.from_user_id, 'to_user_id', d.to_user_id,
          'from_at', d.from_at, 'to_at', d.to_at, 'kinds', d.kinds, 'revoked_at', d.revoked_at)), '[]'::jsonb)
        from hub.delegations d where d.tenant_id = ${a.tenantId}::uuid and d.revoked_at is null
          and (d.from_user_id = any(array[${a.fromUserId}::uuid, ${a.toUserId}::uuid])
            or d.to_user_id = ${a.fromUserId}::uuid)) as existing,
      (select count(*) = 2 from admin.users u where u.tenant_id = ${a.tenantId}::uuid and u.active
        and not u.locked_by_tenant and u.id = any(array[${a.fromUserId}::uuid, ${a.toUserId}::uuid])) as ok`);
  const ex = (
    typeof r?.existing === "string" ? JSON.parse(r.existing) : (r?.existing ?? [])
  ) as Row[];
  return {
    headsOfFrom: r?.heads ?? [],
    existing: ex.map((e) => ({
      fromUserId: e.from_user_id,
      toUserId: e.to_user_id,
      fromAt: toDate(e.from_at),
      toAt: toDate(e.to_at),
      kinds: e.kinds,
      revokedAt: null,
    })),
    usersOk: r?.ok === true,
  };
}

export async function insertDelegation(
  tx: Tx,
  a: { tenantId: string; createdBy: string; d: Omit<DelegationRow, "revokedAt"> },
): Promise<string> {
  const [r] = await tx.execute<{ id: string }>(sql`
    insert into hub.delegations (tenant_id, from_user_id, to_user_id, from_at, to_at, kinds, created_by)
    values (${a.tenantId}::uuid, ${a.d.fromUserId}::uuid, ${a.d.toUserId}::uuid, ${a.d.fromAt.toISOString()}::timestamptz,
      ${a.d.toAt.toISOString()}::timestamptz, ${`{${a.d.kinds.join(",")}}`}::text[], ${a.createdBy}::uuid)
    returning id::text as id`);
  return r?.id as string;
}

export async function revokeDelegation(tx: Tx, tenantId: string, id: string): Promise<void> {
  await tx.execute(sql`update hub.delegations set revoked_at = now()
    where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and revoked_at is null`);
}

/**
 * "Chuyển việc đang giữ" (quản trị / trưởng phòng đặt thay ⇒ tự chuyển): MỘT câu — việc mở A được giao đích danh (hàng `initial`
 * của A) thêm hàng `via='delegated'` cho B; việc nhóm A đang Nhận ⇒ người giữ = B. Chỉ áp loại việc đúng `kinds`, B ≠ người gửi.
 */
export async function moveOpenWork(
  tx: Tx,
  a: { tenantId: string; fromUserId: string; toUserId: string; kinds: readonly DelegationKind[] },
): Promise<void> {
  const taskKinds = [
    ...(a.kinds.some((k) => k === "approve" || k === "form") ? ["review"] : []),
    ...(a.kinds.includes("milestone") ? ["milestone"] : []),
  ];
  const tk = `{${taskKinds.join(",")}}`;
  await tx.execute(sql`
    with t as (
      select t.id, t.tenant_id from hub.review_tasks t
      join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
      where t.tenant_id = ${a.tenantId}::uuid and t.status = 'open' and t.kind = any(${tk}::text[])
        and pr.started_by <> ${a.toUserId}::uuid
        and (t.claimed_by = ${a.fromUserId}::uuid or exists (select 1 from hub.review_task_assignees x
          where x.task_id = t.id and x.tenant_id = t.tenant_id and x.user_id = ${a.fromUserId}::uuid and x.via = 'initial'))
    ), c as (
      update hub.review_tasks r set claimed_by = ${a.toUserId}::uuid from t
      where r.id = t.id and r.tenant_id = t.tenant_id and r.claimed_by = ${a.fromUserId}::uuid returning r.id
    )
    insert into hub.review_task_assignees (tenant_id, task_id, user_id, via, depth, on_behalf_of)
    select t.tenant_id, t.id, ${a.toUserId}::uuid, 'delegated', 0, ${a.fromUserId}::uuid from t
    where exists (select 1 from hub.review_task_assignees x where x.task_id = t.id and x.tenant_id = t.tenant_id
        and x.user_id = ${a.fromUserId}::uuid and x.via = 'initial')
      and not exists (select 1 from hub.review_task_assignees y where y.task_id = t.id and y.tenant_id = t.tenant_id
        and y.user_id = ${a.toUserId}::uuid)`);
}
