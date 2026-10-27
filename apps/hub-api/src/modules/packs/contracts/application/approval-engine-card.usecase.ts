// contract-flow S3b · thẻ duyệt + hành động cho lượt `mode = 'engine'`. Lớp 2: chỉ cổng.
// - `view`: MỘT lần `stepsView` của engine (≤ 2 SQL, scope người xem — `can_act` do engine quyết) trên mẫu chụp + trạng thái lượt đã
//   đọc ở câu `state` (không thêm SQL của gói).
// - `act`: Đạt = `act` pass (duyệt cuối: lưu `pending_links` TRONG tx gói TRƯỚC khi act; tool `contracts-finalize` áp cùng tx khoá);
//   Trả lại = fail + về bước 0; Từ chối = reject (cần lý do) rồi ghi HĐ rejected; Đọc lại = huỷ run (system) ⇒ `extracting` + job.
import type { PackWho } from "../../kit/application/ports";
import { factsOf } from "../domain/approval-engine.rules";
import {
  type EngineAction,
  type EngineErrorCode,
  engineCardView,
  planEngineAct,
} from "../domain/approval-engine-card.rules";
import { engineSteps, esignCard } from "../domain/approval-flow.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEnginePort, EngineCaller } from "./approval-engine.ports";

type Repos = {
  approval: {
    markRejected(
      id: string,
      runId: string,
      e: { kind: "rejected"; feedback: string | null; actor: string },
    ): Promise<boolean>;
    markExtracting(id: string, runId: string): Promise<boolean>;
  };
  approvalEngine: {
    setPendingLinks(aid: string, runId: string, links: readonly unknown[] | null): Promise<boolean>;
  };
  outbox: { enqueue(e: { entity: string; entity_id: string; op: "upsert" }[]): Promise<unknown> };
};
export type EngineCardDeps = {
  port: () => ApprovalEnginePort | undefined;
  /** esign-flow-fix · người xem là owner gói (quyền `admin`, cache — 0 SQL). */
  isAdmin?: ((who: PackWho) => Promise<boolean>) | undefined;
  uow: { tenant<T>(who: PackWho, fn: (r: Repos) => Promise<T>): Promise<T> };
  jobs: {
    enqueue(j: {
      tenantId: string;
      userId: string;
      contractId: string;
      approvalId: string | null;
    }): Promise<void>;
  };
  redo?: { ready: boolean; quota: (tenantId: string) => Promise<void> } | undefined;
};
export type EngineActBody = {
  action: EngineAction;
  feedback?: string | undefined;
  products?: readonly unknown[] | undefined;
};
export type EngineActResult = "ok" | "unavailable" | { error: EngineErrorCode };

const callerOf = (who: PackWho): EngineCaller => ({ ...who, role: "member" });

async function input(d: EngineCardDeps, who: PackWho, st: ApprovalState) {
  const a = st.approval as NonNullable<ApprovalState["approval"]>;
  const port = d.port();
  const sv = port && a.engineRunId ? await port.stepsView(callerOf(who), a.engineRunId) : null;
  return {
    approval: { id: a.id, status: a.status, startedBy: a.startedBy, feedback: a.feedback },
    flow: engineSteps(a.flowSteps ?? []), // esign-flow · bước Ký số không là stage engine
    facts: factsOf(st.deal ?? null, st.value),
    sv,
    viewerId: who.userId,
  };
}

/** Thẻ duyệt của lượt engine (không có cổng engine ⇒ thẻ không bước, không quyết được). */
export function engineView(d: EngineCardDeps) {
  return async (who: PackWho, st: ApprovalState) => {
    const a = st.approval;
    // esign-flow-fix · Gửi lại: người phụ trách HOẶC owner gói (như route); kẹt `sending` quá hạn cũng Gửi lại được.
    const may = st.owner === who.userId || ((await d.isAdmin?.(who)) ?? false);
    const esign = esignCard(
      a?.flowSteps,
      a?.esignStatus,
      a?.esignReason,
      may,
      a?.esignStale === true,
    );
    return { ...engineCardView(await input(d, who, st)), esign };
  };
}

type Ctx = { who: PackWho; id: string; st: ApprovalState; runId: string; b: EngineActBody };

async function decide(
  port: ApprovalEnginePort,
  c: Ctx,
  at: { task_id: string },
  r: { result: "pass" | "fail" | "reject"; feedback?: string; back_to_step?: number },
): Promise<EngineActResult> {
  const out = await port.act(callerOf(c.who), c.runId, at, r);
  return out === "ok" ? "ok" : { error: "APPROVAL_NOT_OPEN" };
}

async function redo(d: EngineCardDeps, port: ApprovalEnginePort, c: Ctx): Promise<EngineActResult> {
  if (d.redo && !d.redo.ready) return "unavailable";
  if (d.redo) await d.redo.quota(c.who.tenantId);
  await port.cancelSys(c.who.tenantId, c.runId); // false = đã kết thúc: vẫn đọc lại
  const aid = (c.st.approval as NonNullable<ApprovalState["approval"]>).id;
  const ok = await d.uow.tenant(c.who, async (r) => {
    if (!(await r.approval.markExtracting(c.id, aid))) return false;
    await r.outbox.enqueue([{ entity: "contract", entity_id: c.id, op: "upsert" }]);
    return true;
  });
  if (!ok) return { error: "APPROVAL_NOT_OPEN" };
  await d.jobs.enqueue({ ...c.who, contractId: c.id, approvalId: aid });
  return "ok";
}

async function reject(d: EngineCardDeps, port: ApprovalEnginePort, c: Ctx, taskId: string) {
  const fb = c.b.feedback ?? null;
  const out = await decide(
    port,
    c,
    { task_id: taskId },
    {
      result: "reject",
      ...(fb ? { feedback: fb } : {}),
    },
  );
  if (out !== "ok") return out;
  const aid = (c.st.approval as NonNullable<ApprovalState["approval"]>).id;
  // Run đã huỷ ở engine; HĐ ⇒ rejected cùng lượt. Lỗi ở đây do vòng quét reconcile sửa (run huỷ + Từ chối).
  await d.uow
    .tenant(c.who, (r) =>
      r.approval.markRejected(c.id, aid, { kind: "rejected", feedback: fb, actor: c.who.userId }),
    )
    .catch(() => false);
  return "ok" as const;
}

/** Hành động trên lượt engine. Lỗi engine (quyền, đã đóng…) ném như route engine; đã có người quyết trước ⇒ APPROVAL_NOT_OPEN. */
export function engineAct(d: EngineCardDeps) {
  return async (
    who: PackWho,
    id: string,
    b: EngineActBody,
    st: ApprovalState,
  ): Promise<EngineActResult> => {
    const a = st.approval;
    const port = d.port();
    if (!a || !port || !a.engineRunId) return { error: "APPROVAL_NOT_OPEN" };
    const plan = planEngineAct({
      ...(await input(d, who, st)),
      action: b.action,
      feedback: b.feedback,
      hasSource: st.hasSource,
    });
    if (plan.kind === "error") return { error: plan.code };
    return exec(d, port, { who, id, st, runId: a.engineRunId, b }, plan);
  };
}

type Plan = Exclude<ReturnType<typeof planEngineAct>, { kind: "error" }>;

/** Đạt duyệt cuối ⇒ LUÔN ghi đè `pending_links` (kể cả null) TRONG tx gói TRƯỚC khi act (tool finalize áp cùng tx khoá) — không để
 *  SP sót của lần Đạt trước; act thất bại / not_open ⇒ xoá lại (không để SP chờ của người không duyệt được). */
async function pass(d: EngineCardDeps, port: ApprovalEnginePort, c: Ctx, p: Plan) {
  const a = c.st.approval as NonNullable<ApprovalState["approval"]>;
  const save = (links: readonly unknown[] | null) =>
    d.uow.tenant(c.who, (r) => r.approvalEngine.setPendingLinks(a.id, c.runId, links));
  if (p.kind !== "pass" || !p.finalizes)
    return decide(port, c, { task_id: p.taskId }, { result: "pass" });
  const links = c.b.products?.length ? c.b.products : null;
  if (!(await save(links))) return { error: "APPROVAL_NOT_OPEN" as const };
  const out = await decide(port, c, { task_id: p.taskId }, { result: "pass" }).catch(
    async (e: unknown) => {
      await save(null).catch(() => false);
      throw e;
    },
  );
  if (out !== "ok") await save(null).catch(() => false);
  return out;
}
async function exec(
  d: EngineCardDeps,
  port: ApprovalEnginePort,
  c: Ctx,
  p: Plan,
): Promise<EngineActResult> {
  if (p.kind === "pass") return pass(d, port, c, p);
  if (p.kind === "reject") return reject(d, port, c, p.taskId);
  if (p.kind === "redo") return p.reextract ? redo(d, port, c) : "ok";
  const fb = c.b.feedback ? { feedback: c.b.feedback } : {};
  return decide(port, c, { task_id: p.taskId }, { result: "fail", ...fb, back_to_step: 0 });
}
/** fix-review · chỉ số bước người dùng ĐANG MỞ của run (null: không bước mở / run không thấy) — luật sửa trường: chỉ s0 mới sửa được. */
export function openStepIdx(d: EngineCardDeps) {
  return async (who: PackWho, runId: string): Promise<number | null> => {
    const sv = await d.port()?.stepsView(callerOf(who), runId);
    const open = sv?.steps.find((s) => s.status === "open" && /^s\d+$/.test(s.key));
    return open ? Number(open.key.slice(1)) : null;
  };
}

export type EngineCard = {
  view: ReturnType<typeof engineView>;
  act: ReturnType<typeof engineAct>;
  openStepIdx: ReturnType<typeof openStepIdx>;
};
export const engineCard = (d: EngineCardDeps): EngineCard => ({
  view: engineView(d),
  act: engineAct(d),
  openStepIdx: openStepIdx(d),
});
