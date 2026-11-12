// PD-R19 · CR-127 E3b/E5 · cấu hình task duyệt lúc mở (tách từ `core.repo.ts` — giữ ≤ 400 dòng): mốc nhắc/chuyển cấp chép từ SNAPSHOT
// stage của run, cửa duyệt (trưởng phòng / người cụ thể), R#15 người gửi duy nhất, và E5 "Cần: tất cả" (tập người bỏ phiếu + đích n=0).
// MỘT câu tra PK `stage_runs` + `process_runs` (các subquery cùng câu); phần tính thuần ở `stageCfgOf`.
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { REMIND_AFTER_H } from "../domain/limits";
import { reviewTaskTiming } from "../domain/notify/remind.rules";
import { zeroVoterTargets } from "../domain/tasks/all-vote.rules";
import { type SoleTargets, soleStarterTargets } from "../domain/tasks/delegation.rules";
import { headGateSql } from "./head-gate.sql";

type AfterCfg = {
  remind_every_h?: number | null;
  escalate?: {
    after_h: number;
    group_id?: string | null;
    group_key?: string;
    user_id?: string | null;
  } | null;
  need?: string;
};

export type TimingInput = {
  tenantId: string;
  stageRunId: string;
  remindAt: Date;
  userIds: readonly string[];
  groupId: string | null;
};

/** E5 · bước "Cần: tất cả" (không có cửa duyệt): tập người bỏ phiếu + đích giao khi n = 0. */
export type AllCfg = { voters: string[]; zero: SoleTargets | null };

type CfgRow = {
  after: AfterCfg | string | null;
  esc_key_id: string | null;
  gate: string | null;
  starter: string;
  admin_ids: string[] | null;
  voters: string[] | null;
};

/**
 * cr125-fix-escalate-kick · Group chuyển cấp = `group_id` của snapshot, vắng ⇒ `group_key` → id CÙNG tenant. Không ra Group ⇒ bỏ chuyển
 * cấp (task vẫn mở) thay vì vi phạm `review_tasks_remind_ck`. Mốc tạo = `remindAt − REMIND_AFTER_H`.
 * E5 · `need='all'` + không cửa ⇒ người bỏ phiếu = thành viên Group của task còn dùng được (active, không khoá), trừ người gửi.
 */
export async function reviewTimingOf(tx: Tx, t: TimingInput) {
  // CR-127 · E3b · R#15 · người duyệt duy nhất = người gửi (cửa duyệt / một người đích danh) ⇒ đọc thêm quản trị công ty (CÙNG câu).
  const soleUser = t.userIds.length === 1 && !t.groupId ? (t.userIds[0] as string) : null;
  const [row] = await tx.execute<CfgRow>(sql`
    select x.after, (select g.id::text from admin.groups g where g.tenant_id = s.tenant_id
        and g.key = x.after->'escalate'->>'group_key') as esc_key_id,
      gx.gate, pr.started_by::text as starter,
      case when gx.gate = pr.started_by::text or ${soleUser}::uuid = pr.started_by or gx.all_vote then array(select u.id::text
        from admin.users u where u.tenant_id = s.tenant_id and u.role = 'tenant_admin' and u.active
          and not u.locked_by_tenant and u.id <> pr.started_by order by u.id) end as admin_ids,
      case when gx.all_vote then array(select gm.user_id::text from admin.group_members gm
        join admin.users u on u.id = gm.user_id and u.tenant_id = gm.tenant_id
        where gm.tenant_id = s.tenant_id and gm.group_id = ${t.groupId}::uuid and u.active and not u.locked_by_tenant
          and u.id <> pr.started_by order by gm.user_id) end as voters
    from hub.stage_runs s
    join hub.process_runs pr on pr.id = s.process_run_id and pr.tenant_id = s.tenant_id
    cross join lateral (select pr.snapshot->'stages'->(s.stage_idx::int)->'after' as after) x
    cross join lateral (select ${headGateSql("pr.snapshot->'stages'->(s.stage_idx::int)", "s.tenant_id")}::text
      as gate) g0
    cross join lateral (select g0.gate, (g0.gate is null and x.after->>'need' = 'all') as all_vote) gx
    where s.id = ${t.stageRunId} and s.tenant_id = ${t.tenantId}`);
  return stageCfgOf(t, soleUser, row);
}

/** Phần tính (không I/O) của `reviewTimingOf`: mốc nhắc/chuyển cấp + cửa duyệt + R#15 + E5. */
function stageCfgOf(t: TimingInput, soleUser: string | null, row: CfgRow | undefined) {
  const raw = row?.after ?? null;
  const after: AfterCfg = (typeof raw === "string" ? JSON.parse(raw) : raw) ?? {};
  const esc = after.escalate ?? null;
  const groupId = esc ? (esc.group_id ?? row?.esc_key_id ?? null) : null;
  const timing = reviewTaskTiming(new Date(t.remindAt.getTime() - REMIND_AFTER_H * 3_600_000), {
    remindEveryH: after.remind_every_h ?? null,
    escalate: esc ? { afterH: esc.after_h, groupId, userId: esc.user_id ?? null } : null, // E3c · người
  });
  const gate = row?.gate ?? null;
  const targets = { userId: esc?.user_id ?? null, groupId, adminIds: row?.admin_ids ?? [] };
  const sole = soleStarterTargets({ gate, soleUser, starter: row?.starter ?? null }, targets);
  return { timing, gate, sole, all: allCfgOf(row, targets) };
}

function allCfgOf(
  row: CfgRow | undefined,
  targets: Parameters<typeof zeroVoterTargets>[1],
): AllCfg | null {
  const voters = row?.voters ?? null;
  if (!voters) return null;
  const zero = voters.length === 0 ? zeroVoterTargets(row?.starter ?? null, targets) : null;
  return { voters, zero };
}
