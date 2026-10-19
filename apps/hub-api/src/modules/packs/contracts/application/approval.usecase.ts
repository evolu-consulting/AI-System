// HD-FR-31 · HD-FR-34 · HD-FR-36 · HD-FR-37 · D3-05/D3-06/D3-12 · HD3 plan §2: mở run duyệt cho HĐ, xem/quyết bước duyệt, cài đặt
// tenant. Id run đọc trong tx gói (RLS) rồi mới hỏi engine (security L3 N2). Từ chối ⇒ ghi "Bị từ chối" ngay; run kết thúc ở
// nơi khác (chat-web) ⇒ hoà giải khi xem. Lớp 2: chỉ cổng.
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../kit/application/pack-runs.ports";
import { startPackRun } from "../../kit/application/start-pack-run.usecase";
import {
  APPROVAL_PROCESS_KEY,
  type ApprovalSettings,
  type ApprovalStep,
  approvalStepOf,
  buildApprovalDef,
  LEVEL1_STAGE,
} from "../domain/approval-def.rules";
import type { RunPhase } from "../domain/approval-edit.rules";
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
  next?: ApprovalSettings,
): Promise<ApprovalSettings | null> {
  const port = d.bridge.port;
  if (!port) return null;
  const s = next ?? (await d.uow.tenant(who(u), (r) => r.approval.settings()));
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
    // Review m4: chỉ run huỷ/Từ chối ⇒ "Bị từ chối"; run lỗi/hết hạn để vòng quét ghi `extract_failed FLOW_FAILED`.
    if (s.status === "cancelled" && OPEN.has(cur.status)) {
      const runId = cur.runId;
      const kind = s.rejected ? ("rejected" as const) : ("cancelled" as const);
      const e = { kind, feedback: s.feedback, actor: null };
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

/** Quyết task qua engine. "Đọc lại": đánh dấu `extracting` TRƯỚC để stage trích chạy lại thật sự trích; engine từ chối /
 *  không còn task ⇒ hoàn tác. */
async function decide(
  d: ApprovalDeps,
  u: PackRunCaller,
  c: { id: string; runId: string; status: string; src: boolean },
  b: ApprovalAction,
): Promise<"ok" | "not_open"> {
  const port = d.bridge.port as PackRunsPort;
  const mark = (on: boolean) =>
    d.uow.tenant(who(u), (r) => r.approval.markExtracting(c.id, c.runId, on));
  const redo = b.action === "redo" && c.status === "needs_review" && c.src && (await mark(true));
  const body = {
    result: RESULT[b.action],
    ...(b.feedback === undefined ? {} : { feedback: b.feedback }),
  };
  try {
    const out = await port.act(u, c.runId, body);
    if (out === "not_open" && redo) await mark(false);
    return out;
  } catch (e) {
    if (redo) await mark(false);
    throw e;
  }
}

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
    const out = await decide(
      d,
      u,
      { id, runId: cur.runId, status: cur.status, src: cur.hasSource },
      b,
    );
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
    // Review m5 · đồng bộ def TRƯỚC (lỗi ⇒ không đổi cài đặt), rồi lưu + nhật ký trong một câu (M1).
    await ensureDef(d, u, true, s);
    return d.uow.tenant(who(u), (r) => r.approval.saveSettings(s, u.userId));
  };
}

export function readApprovalSettings(d: ApprovalDeps) {
  return (u: PackRunCaller) => d.uow.tenant(who(u), (r) => r.approval.settings());
}

const DONE_RUN = new Set(["done", "cancelled", "failed", "expired"]);

/** Review S1 · seam sửa trường: giai đoạn run của HĐ (engine) + mở lại duyệt (D3-13: run mới sau khi sửa tiền HĐ đã duyệt). */
export function patchGuard(d: ApprovalDeps) {
  const start = startApproval(d);
  return {
    async phase(w: { tenantId: string; userId: string }, runId: string): Promise<RunPhase> {
      const s = await d.bridge.port?.state({ ...w, role: "member" }, runId);
      if (!s || DONE_RUN.has(s.status)) return "none";
      return s.stage_key === LEVEL1_STAGE ? "level1" : "later";
    },
    /** Không ném: PATCH đã COMMIT; mở run lỗi (def tắt, trần…) ⇒ log, vòng quét mở lại sau (`orphanReopens`). */
    async restart(w: { tenantId: string; userId: string }, id: string): Promise<void> {
      const r = await start({ ...w, role: "member" }, id).catch(() => ({ kind: "error" as const }));
      if (r.kind !== "ok")
        d.warn("contract-approval-reopen-not-started", { contract_id: id, kind: r.kind });
    },
  };
}
