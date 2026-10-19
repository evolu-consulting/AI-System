// HD-FR-31 · HD-FR-34 · HD-FR-36 · HD-FR-37 · D3-05/D3-06/D3-12 · HD3 plan §2: mở run duyệt cho HĐ, xem/quyết bước duyệt, cài đặt
// tenant. Id run đọc trong tx gói (RLS) rồi mới hỏi engine (security L3 N2). Từ chối ⇒ ghi "Bị từ chối" ngay; run kết thúc ở
// nơi khác (chat-web) ⇒ hoà giải khi xem. Lớp 2: chỉ cổng.
import type { PackRunCaller, PackRunsBridge } from "../../kit/application/pack-runs.ports";
import { startPackRun } from "../../kit/application/start-pack-run.usecase";
import {
  APPROVAL_PROCESS_KEY,
  type ApprovalSettings,
  type ApprovalStep,
  approvalStepOf,
  buildApprovalDef,
} from "../domain/approval-def.rules";
import type { ApprovalUow } from "./approval.ports";

export type ApprovalDeps = {
  bridge: PackRunsBridge;
  uow: ApprovalUow;
  warn: (msg: string, meta: Record<string, unknown>) => void;
};
export type StartApproval = (
  u: PackRunCaller,
  id: string,
) => Promise<
  | { kind: "ok"; runId: string }
  | { kind: "engine_off" | "not_found" | "has_run" | "unavailable" | "not_allowed" }
>;
export type ContractApproval = {
  run_id: string | null;
  run_status: string | null;
  step: ApprovalStep | null;
  task_id: string | null;
  can_act: boolean;
  feedback: string | null;
};
export type ApprovalAction = { action: "approve" | "reject" | "redo"; feedback?: string };

const TERMINAL = new Set(["done", "cancelled", "failed", "expired"]);
const OPEN = new Set(["extracting", "extract_failed", "needs_review"]);
const who = (u: PackRunCaller) => ({ tenantId: u.tenantId, userId: u.userId });

/** D3-05 · D3-12 · def theo cài đặt tenant (Group theo khoá); `sync` khi cài đặt đổi. */
async function ensureDef(
  d: ApprovalDeps,
  u: PackRunCaller,
  sync: boolean,
): Promise<ApprovalSettings | null> {
  const port = d.bridge.port;
  if (!port) return null;
  const s = await d.uow.tenant(who(u), (r) => r.approval.settings());
  const ids = await port.groupIdsOf(u.tenantId, [s.level1GroupKey, s.level2GroupKey]);
  const g1 = ids.get(s.level1GroupKey);
  const g2 = ids.get(s.level2GroupKey);
  if (!g1 || !g2) return null;
  await port.ensureDef(u, buildApprovalDef({ level1GroupId: g1, level2GroupId: g2 }), { sync });
  return s;
}

export function startApproval(d: ApprovalDeps): StartApproval {
  return async (u, id) => {
    const port = d.bridge.port;
    if (!port) return { kind: "engine_off" };
    const cur = await d.uow.tenant(who(u), (r) => r.approval.runOf(id));
    if (!cur) return { kind: "not_found" };
    if (!OPEN.has(cur.status)) return { kind: "not_allowed" };
    if (cur.runId) {
      const [o] = await port.outcomes(u, [cur.runId]);
      if (o && !TERMINAL.has(o.status)) return { kind: "has_run" };
    }
    if (!(await ensureDef(d, u, false))) return { kind: "unavailable" };
    const prev = cur.runId;
    const req = {
      process_key: APPROVAL_PROCESS_KEY,
      input: id,
      inputs: [{ type: "text", key: "contract-id", text: id }],
    };
    return startPackRun(d, u, req, {
      async check(r) {
        const now = await r.approval.runOf(id);
        if (!now) return "not_found";
        return now.runId === prev ? "ok" : "has_run";
      },
      attach: (r, runId) => r.approval.attachRun(id, runId, prev, u.userId),
    });
  };
}

/** Trạng thái duyệt của HĐ; run đã kết thúc không Đạt mà HĐ còn trong flow ⇒ ghi "Bị từ chối" (D3-06). */
export function getApproval(d: ApprovalDeps) {
  return async (u: PackRunCaller, id: string): Promise<ContractApproval | null> => {
    const cur = await d.uow.tenant(who(u), (r) => r.approval.runOf(id));
    if (!cur) return null;
    const none: ContractApproval = {
      run_id: cur.runId,
      run_status: null,
      step: null,
      task_id: null,
      can_act: false,
      feedback: null,
    };
    const port = d.bridge.port;
    if (!cur.runId || !port) return none;
    const s = await port.state(u, cur.runId);
    if (!s) return none;
    const step = approvalStepOf(s.status, s.stage_key, s.rejected);
    if ((step === "rejected" || step === "cancelled") && OPEN.has(cur.status)) {
      const runId = cur.runId;
      const e = { kind: step, feedback: s.feedback, actor: null };
      await d.uow.tenant(who(u), (r) => r.approval.markRejected(id, runId, e));
    }
    return {
      run_id: cur.runId,
      run_status: s.status,
      step,
      task_id: s.task?.id ?? null,
      can_act: s.task?.can_act ?? false,
      feedback: s.feedback,
    };
  };
}

const RESULT = { approve: "pass", reject: "reject", redo: "fail" } as const;

/** Quyết task duyệt đang mở (engine kiểm quyền + `exclude_starter`); Từ chối ⇒ ghi "Bị từ chối" ngay. */
export function actApproval(d: ApprovalDeps) {
  const get = getApproval(d);
  return async (
    u: PackRunCaller,
    id: string,
    b: ApprovalAction,
  ): Promise<ContractApproval | "not_found" | "not_open"> => {
    const cur = await d.uow.tenant(who(u), (r) => r.approval.runOf(id));
    if (!cur) return "not_found";
    const port = d.bridge.port;
    if (!cur.runId || !port || !OPEN.has(cur.status)) return "not_open";
    const out = await port.act(u, cur.runId, {
      result: RESULT[b.action],
      ...(b.feedback === undefined ? {} : { feedback: b.feedback }),
    });
    if (out === "not_open") return "not_open";
    if (b.action === "reject") {
      const runId = cur.runId;
      const e = { kind: "rejected" as const, feedback: b.feedback ?? null, actor: u.userId };
      await d.uow.tenant(who(u), (r) => r.approval.markRejected(id, runId, e));
    }
    return (await get(u, id)) ?? "not_found";
  };
}

/** HD-FR-37 · lưu cài đặt rồi đồng bộ def (Group mới vào stage duyệt). Group không có ⇒ `group_missing` (không lưu). */
export function saveApprovalSettings(d: ApprovalDeps) {
  return async (
    u: PackRunCaller,
    s: ApprovalSettings,
  ): Promise<ApprovalSettings | "group_missing" | "engine_off"> => {
    const port = d.bridge.port;
    if (!port) return "engine_off";
    const ids = await port.groupIdsOf(u.tenantId, [s.level1GroupKey, s.level2GroupKey]);
    if (!ids.has(s.level1GroupKey) || !ids.has(s.level2GroupKey)) return "group_missing";
    const saved = await d.uow.tenant(who(u), (r) => r.approval.saveSettings(s, u.userId));
    await ensureDef(d, u, true);
    return saved;
  };
}

export function readApprovalSettings(d: ApprovalDeps) {
  return (u: PackRunCaller) => d.uow.tenant(who(u), (r) => r.approval.settings());
}
