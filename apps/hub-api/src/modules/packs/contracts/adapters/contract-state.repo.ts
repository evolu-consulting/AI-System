// CR-127 K1a · BR-02 · spec §3: cổng DUY NHẤT đổi `contracts.status`. MỘT câu CTE hằng (Luật 4c): đặt GUC `contracts.state_gate` = id
// (trigger `contracts_status_gate`, MIGC 0091) → UPDATE CAS `status = from` (+ `run_id` khi hook theo lượt) → INSERT
// `contract_events(type='status_changed', data{from,to,ev,reason,evidence_id})`. 0 hàng ⇒ STATE_CONFLICT (người gọi trả 409; hook bỏ qua,
// không ném). Vào DONE: `confirmed_*` + `effect = contracts.effect_of(...)` trong CÙNG câu, rồi `ContractDoneHook.onDone` cùng tx.
// Phát sự kiện flow (`contract.submitted`/`received`) do usecase gọi theo `sideEffects` của luật (K3/K8).
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { ContractDoneHook } from "../application/contract-done.ports";
import {
  type ContractEv,
  type ContractState,
  FROM_OF,
  type TransitionCtx,
  transition,
} from "../domain/contract-state.rules";
import { DEFAULT_TENANT_TZ, localDate } from "../domain/local-time.rules";
import { moveOpenMilestones } from "./version-milestones.repo";

export type ApplyTransitionInput = {
  contractId: string;
  ev: ContractEv;
  actorId: string | null;
  ctx?: TransitionCtx;
  reason?: string | null;
  evidenceId?: string | null;
  /** CAS theo lượt chạy (hook kết cục flow): chỉ đổi khi `run_id` khớp. */
  runId?: string | null;
  /** Ngày hôm nay theo múi giờ công ty (tính `effect` khi vào DONE); vắng ⇒ múi mặc định. */
  today?: string;
  /** Điều kiện CAS thêm (bí danh hàng HĐ = `c`), cùng câu UPDATE — máy duyệt cũ (Z1 gỡ) dùng cho luật ngưỡng cấp 2. */
  extra?: SQL;
};
export type ApplyTransitionResult =
  | { ok: true; from: ContractState; to: ContractState }
  | { ok: false; code: "STATE_CONFLICT" };

type Plan = Extract<ReturnType<typeof transition>, { to: ContractState }>;

/** Tham số câu từ luật (tách khỏi hàm áp để mỗi hàm gọn). */
function params(i: ApplyTransitionInput, from: ContractState, t: Plan) {
  const c = t.cols;
  return {
    extract: c.extractState ?? null,
    inc: c.submitRoundInc ? 1 : 0,
    by: c.submittedBy === true,
    confirm: c.confirm === true,
    runId: i.runId ?? null,
    today: i.today ?? localDate(new Date(), DEFAULT_TENANT_TZ),
    data: JSON.stringify({
      from,
      to: t.to,
      ev: i.ev,
      reason: i.reason ?? null,
      evidence_id: i.evidenceId ?? null,
    }),
  };
}

async function applyQ(tx: Tx, tid: string, i: ApplyTransitionInput, from: ContractState, t: Plan) {
  const p = params(i, from, t);
  const [r] = await tx.execute<{ n: number }>(sql`with
    g as (select set_config('contracts.state_gate', ${i.contractId}::text, true) as v),
    u as (update contracts.contracts c set status = ${t.to},
        extract_state = coalesce(${p.extract}::text, c.extract_state),
        submit_round = c.submit_round + ${p.inc}::int,
        submitted_by = case when ${p.by}::boolean then ${i.actorId}::uuid else c.submitted_by end,
        confirmed_at = case when ${p.confirm}::boolean then coalesce(c.confirmed_at, now()) else c.confirmed_at end,
        confirmed_by = case when ${p.confirm}::boolean then coalesce(${i.actorId}::uuid, c.confirmed_by)
          else c.confirmed_by end,
        effect = contracts.effect_of(${t.to}::text, c.superseded_at, c.effect_outcome, c.start_date, c.end_date, c.fields,
          ${p.today}::date),
        version = c.version + 1, updated_at = now()
      from g where g.v is not null and c.id = ${i.contractId}::uuid and c.tenant_id = ${tid}::uuid
        and c.status = ${from} and (${p.runId}::uuid is null or c.run_id = ${p.runId}::uuid)
        and ${i.extra ?? sql`true`}
      returning c.id),
    ev as (insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      select ${tid}::uuid, u.id, 'status_changed', ${i.actorId}::uuid, ${p.data}::jsonb from u)
    select (select count(*) from u)::int as n`);
  return r?.n ?? 0;
}

/**
 * Tính lại `effect` cho tập HĐ vừa INSERT ở DONE (`initialState(...).sideEffects` có `refresh_effect`) — MỘT câu theo tập qua hàm DB
 * `contracts.refresh_effect` (INVOKER, RLS lọc tenant). Rỗng ⇒ không gọi. Trả số hàng đổi.
 */
export async function refreshEffect(
  tx: Tx,
  ids: readonly string[],
  today?: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const [r] = await tx.execute<{ n: number }>(sql`select contracts.refresh_effect(
    ${`{${ids.join(",")}}`}::uuid[], ${today ?? localDate(new Date(), DEFAULT_TENANT_TZ)}::date) as n`);
  return Number(r?.n ?? 0);
}

const hooks = new Map<string, ContractDoneHook>();
/** Mọi đường vào DONE (cổng, máy cũ, outcome flow) chạy CHUNG các hook đã đăng ký (K6 `renewal`, K7 lập mốc AI…) theo thứ tự đăng ký; khoá trùng ⇒ thay; `null` ⇒ gỡ. */
export function registerContractDoneHook(h: ContractDoneHook | null, key = "default"): void {
  if (h) hooks.set(key, h);
  else hooks.delete(key);
}
const defaultHook: ContractDoneHook = {
  async onDone(tx, tid, id) {
    for (const h of hooks.values()) await h.onDone(tx, tid, id);
  },
};

export function contractStateRepo(tx: Tx, tid: string) {
  return {
    async applyTransition(
      i: ApplyTransitionInput,
      hook: ContractDoneHook = defaultHook,
    ): Promise<ApplyTransitionResult> {
      const from = FROM_OF[i.ev];
      const t = transition(from, i.ev, i.ctx ?? {});
      if ("error" in t) return { ok: false, code: "STATE_CONFLICT" };
      // K5 · BR-36b: v(n+1) vào DONE ⇒ mốc mở của bản trước chuyển sang v(n+1) TRƯỚC câu đổi trạng thái (trigger thay bản cũ chạy sau).
      if (t.to === "done")
        await moveOpenMilestones(tx, tid, {
          contractId: i.contractId,
          from,
          runId: i.runId ?? null,
          ...(i.extra ? { extra: i.extra } : {}),
          actorId: i.actorId,
        });
      if ((await applyQ(tx, tid, i, from, t)) === 0) return { ok: false, code: "STATE_CONFLICT" };
      if (t.sideEffects.includes("done_hook")) await hook.onDone(tx, tid, i.contractId);
      return { ok: true, from, to: t.to };
    },
  };
}
export type ContractStateRepo = ReturnType<typeof contractStateRepo>;
