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
  revoked_by: string | null;
  rev_name: string | null;
};
export type DelegationView = DelegationRow & {
  id: string;
  createdBy: string;
  revokedBy: string | null;
  names: { from: string; to: string; by: string; rev: string | null };
};
export type DelegationStatus = "active" | "expired" | "revoked";
export type HistoryView = DelegationView & { status: DelegationStatus; doneCount: number };
export type WorkRow = {
  taskId: string;
  runId: string;
  kind: string;
  result: string | null;
  stageName: string | null;
  packKey: string | null;
  packRecordId: string | null;
  decidedAt: Date;
};

const toDate = (v: Date | string) => (v instanceof Date ? v : new Date(v));
const nm = (col: string) =>
  sql.raw(`(select coalesce(nullif(u.display_name, ''), u.username) from admin.users u
    where u.id = ${col} and u.tenant_id = d.tenant_id)`);
const COLS = sql`d.id, d.from_user_id, d.to_user_id, d.from_at, d.to_at, d.kinds, d.created_by, d.revoked_at, d.revoked_by,
  ${nm("d.from_user_id")} as from_name, ${nm("d.to_user_id")} as to_name, ${nm("d.created_by")} as by_name,
  case when d.revoked_by is null then null else ${nm("d.revoked_by")} end as rev_name`;
const SELECT = sql`select ${COLS} from hub.delegations d`;

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
    revokedBy: r.revoked_by ?? null,
    names: {
      from: r.from_name ?? r.from_user_id,
      to: r.to_name ?? r.to_user_id,
      by: r.by_name ?? r.created_by,
      rev: r.rev_name ?? null,
    },
  };
}

/** Trưởng phòng (các phòng) mà `userId` là thành viên — R#43 / đặt thay. */
const headsOf = (tenant: string, user: SQL) =>
  sql`array(select dp.head_user_id::text from admin.departments dp
    join admin.group_members gm on gm.group_id = dp.group_id and gm.tenant_id = dp.tenant_id
    where dp.tenant_id = ${tenant}::uuid and gm.user_id = ${user} and dp.head_user_id is not null)`;

/** Điều kiện «ai xem được» dùng chung cho danh sách và lịch sử (R#43). */
const visible = (a: { tenantId: string; viewerId: string; all: boolean; mine: boolean }) =>
  sql`d.tenant_id = ${a.tenantId}::uuid and (
    d.from_user_id = ${a.viewerId}::uuid or d.to_user_id = ${a.viewerId}::uuid
    or (not ${a.mine} and (${a.all} or ${a.viewerId}::text = any(${headsOf(a.tenantId, sql.raw("d.from_user_id"))}))))`;

/**
 * Danh sách người xem được (R#43): bản thân from/to ∪ quản trị (`all`) ∪ trưởng phòng của người uỷ quyền. `mine` ⇒ chỉ from/to là mình.
 * Mới nhất trước, ≤ 200.
 */
export async function listDelegations(
  tx: Tx,
  a: { tenantId: string; viewerId: string; all: boolean; mine: boolean },
): Promise<DelegationView[]> {
  const rows = await tx.execute<Row>(sql`${SELECT}
    where ${visible(a)}
    order by d.created_at desc, d.id limit 200`);
  return rows.map(view);
}

type HistRow = Row & { status: DelegationStatus; done_count: number | string };
type Page = {
  tenantId: string;
  viewerId: string;
  all: boolean;
  mine: boolean;
  limit: number;
  offset: number;
};

/**
 * CR-184 · lịch sử uỷ quyền (tải dần): MỘT câu — hàng + trạng thái + số việc người được giao đã làm thay trong đợt (đếm theo hàng giao việc
 * `via='delegated'` của đúng cặp A→B, việc đã đóng do B quyết trong [from_at, to_at); index `review_task_assignees_delegated_idx`).
 * Lấy `limit + 1` hàng để biết còn trang kế.
 */
export async function historyDelegations(
  tx: Tx,
  a: Page,
): Promise<{ items: HistoryView[]; next: number | null }> {
  const rows = await tx.execute<HistRow>(sql`select ${COLS},
    case when d.revoked_at is not null then 'revoked' when d.to_at <= now() then 'expired' else 'active' end as status,
    (select count(*) from hub.review_task_assignees x
      join hub.review_tasks t on t.id = x.task_id and t.tenant_id = x.tenant_id
      where x.tenant_id = d.tenant_id and x.via = 'delegated' and x.on_behalf_of = d.from_user_id and x.user_id = d.to_user_id
        and t.status = 'closed' and t.decided_by = d.to_user_id and t.decided_at >= d.from_at and t.decided_at < d.to_at) as done_count
    from hub.delegations d where ${visible(a)}
    order by d.created_at desc, d.id limit ${a.limit + 1} offset ${a.offset}`);
  return {
    items: rows
      .slice(0, a.limit)
      .map((r) => ({ ...view(r), status: r.status, doneCount: Number(r.done_count) })),
    next: rows.length > a.limit ? a.offset + a.limit : null,
  };
}

type WRow = {
  task_id: string;
  run_id: string;
  kind: string;
  result: string | null;
  stage_name: string | null;
  pack_key: string | null;
  pack_record_id: string | null;
  decided_at: Date | string;
};

/** CR-184 · việc người được giao đã làm thay trong một uỷ quyền (cùng điều kiện đếm), mới nhất trước, tải dần. MỘT câu. */
export async function delegationWork(
  tx: Tx,
  a: { tenantId: string; id: string; limit: number; offset: number },
): Promise<{ items: WorkRow[]; next: number | null }> {
  const rows =
    await tx.execute<WRow>(sql`select t.id::text as task_id, t.process_run_id::text as run_id, t.kind, t.result,
      pr.snapshot->'stages'->(s.stage_idx::int)->>'name' as stage_name, pr.pack_key, pr.pack_record_id::text as pack_record_id, t.decided_at
    from hub.delegations d
    join hub.review_task_assignees x on x.tenant_id = d.tenant_id and x.via = 'delegated' and x.on_behalf_of = d.from_user_id
      and x.user_id = d.to_user_id
    join hub.review_tasks t on t.id = x.task_id and t.tenant_id = x.tenant_id and t.status = 'closed' and t.decided_by = d.to_user_id
      and t.decided_at >= d.from_at and t.decided_at < d.to_at
    join hub.stage_runs s on s.id = t.stage_run_id and s.tenant_id = t.tenant_id
    join hub.process_runs pr on pr.id = t.process_run_id and pr.tenant_id = t.tenant_id
    where d.id = ${a.id}::uuid and d.tenant_id = ${a.tenantId}::uuid
    order by t.decided_at desc, t.id limit ${a.limit + 1} offset ${a.offset}`);
  return {
    items: rows.slice(0, a.limit).map((r) => ({
      taskId: r.task_id,
      runId: r.run_id,
      kind: r.kind,
      result: r.result,
      stageName: r.stage_name,
      packKey: r.pack_key,
      packRecordId: r.pack_record_id,
      decidedAt: toDate(r.decided_at),
    })),
    next: rows.length > a.limit ? a.offset + a.limit : null,
  };
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
        and not u.locked_by_tenant and u.kind = 'internal'
        and u.id = any(array[${a.fromUserId}::uuid, ${a.toUserId}::uuid])) as ok`);
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

export async function revokeDelegation(
  tx: Tx,
  tenantId: string,
  id: string,
  by: string,
): Promise<void> {
  await tx.execute(sql`update hub.delegations set revoked_at = now(), revoked_by = ${by}::uuid
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
