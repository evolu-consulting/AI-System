// contract-flow S3b · thẻ duyệt + hành động cho lượt `mode = 'engine'`. Lớp 2: chỉ cổng.
// - `view`: MỘT lần `stepsView` của engine (≤ 2 SQL, scope người xem — `can_act` do engine quyết) trên mẫu chụp + trạng thái lượt đã
//   đọc ở câu `state` (không thêm SQL của gói).
// - `act`: Đạt = `act` pass (duyệt cuối: lưu `pending_links` TRONG tx gói TRƯỚC khi act; tool `contracts-finalize` áp cùng tx khoá);
//   Trả lại = fail + về bước 0; Từ chối = reject (cần lý do) rồi ghi HĐ rejected; Đọc lại = huỷ run (system) ⇒ `extracting` + job.
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import type { PackWho } from "../../kit/public";
import { factsOf } from "../domain/approval-engine.rules";
import {
  type EngineAction,
  type EngineAttention,
  type EngineErrorCode,
  engineCardView,
  planEngineAct,
} from "../domain/approval-engine-card.rules";
import { engineSteps, esignCard } from "../domain/approval-flow.rules";
import { contractRunInputs, usesContractInputs } from "../domain/approval-run-inputs.rules";
import type { ApprovalState } from "./approval.ports";
import type { ApprovalEnginePort, ApprovalEngineRepo, EngineCaller } from "./approval-engine.ports";

type Repos = {
  approval: {
    markRejected(
      id: string,
      runId: string,
      e: { kind: "rejected"; feedback: string | null; actor: string },
      o?: { reviewer?: boolean },
    ): Promise<boolean>;
    markExtracting(id: string, runId: string): Promise<boolean>;
    /** CR-109 · khoá theo luật thấy cũ (không cờ duyệt): null ⇒ người gọi chỉ là người duyệt ngoài cây. */
    state(id: string, o: { lock: boolean }): Promise<unknown>;
  };
  approvalEngine: Pick<
    ApprovalEngineRepo,
    "setPendingLinks" | "recordOverride" | "voidOverride" | "recordDecision"
  > & {
    difyFacts?: ApprovalEngineRepo["difyFacts"];
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
  /** CR-113 · tên Group (cho `escalated_to`); vắng ⇒ không hiện tên. Chỉ gọi khi có bước đã chuyển cấp. */
  groupNames?: ((tenantId: string) => Promise<{ id: string; name: string }[]>) | undefined;
  /** CR-113 · giờ server (`overdue`); vắng ⇒ `new Date()`. */
  now?: () => Date;
  warn?: (msg: string, meta: Record<string, unknown>) => void;
};
export type EngineActBody = {
  action: EngineAction;
  feedback?: string | undefined;
  products?: readonly unknown[] | undefined;
  /** CR-120 · task người bấm thấy (FlowRuntime.act); khác task engine định quyết ⇒ APPROVAL_NOT_OPEN (bấm lại không quyết bước kế). */
  expect?: { taskId: string } | undefined;
};
export type EngineActResult = "ok" | "unavailable" | { error: EngineErrorCode };

const callerOf = (who: PackWho): EngineCaller => ({ ...who, role: "member" });

async function input(d: EngineCardDeps, who: PackWho, st: ApprovalState) {
  const a = st.approval as NonNullable<ApprovalState["approval"]>;
  const port = d.port();
  const sv = port && a.engineRunId ? await port.stepsView(callerOf(who), a.engineRunId) : null;
  const escalated = sv?.steps.some((s) => s.escalated && s.escalated_group_id) === true;
  const names = escalated && d.groupNames ? await d.groupNames(who.tenantId) : [];
  const extras = {
    overrides: new Set(a.overrideTasks ?? []),
    now: d.now?.() ?? new Date(),
    groupNames: new Map(names.map((g) => [g.id, g.name])),
  };
  return {
    extras,
    approval: {
      id: a.id,
      status: a.status,
      startedBy: a.startedBy,
      feedback: a.feedback,
      engineRunId: a.engineRunId ?? null, // CR-107 · null ⇒ lượt kẹt chưa có run
      updatedAt: a.updatedAt ?? null, // CR-122 · P11b · FLOW_STARTING quá 2 phút ⇒ kẹt
    },
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
      // esign-sweep2 · hạn ký / quá hạn / đã nhắc tính ở server (giờ server, không tin đồng hồ máy khách).
      { at: a?.esignAt ?? null, remindedAt: a?.esignRemindedAt ?? null, now: new Date() },
    );
    const card = engineCardView(await input(d, who, st));
    return { ...card, attention: withFactLabels(card.attention), esign };
  };
}

/** CR-122 · P18 · một nguồn nhãn: dữ kiện của manifest app (khoá lạ ⇒ giữ khoá, không mất thông tin). */
const FACT_LABEL = new Map(
  (CONTRACTS_MANIFEST.events ?? []).flatMap((e) => (e.facts ?? []).map((f) => [f.key, f.label])),
);
function withFactLabels(a: EngineAttention | null): EngineAttention | null {
  if (!a?.missing) return a;
  return { ...a, missing: a.missing.map((k) => FACT_LABEL.get(k) ?? k) };
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
  // CR-109 · Đọc lại (huỷ run + AI đọc lại, tốn quota) chỉ cho người ghi được HĐ theo luật thấy cũ — người duyệt ngoài cây chỉ
  // đọc + quyết ⇒ chặn TRƯỚC khi huỷ run (sau khi huỷ họ mất quyền, HĐ sẽ kẹt).
  if (!(await d.uow.tenant(c.who, (r) => r.approval.state(c.id, { lock: true }))))
    return { error: "APPROVAL_NOT_OPEN" };
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
      r.approval.markRejected(
        c.id,
        aid,
        { kind: "rejected", feedback: fb, actor: c.who.userId },
        { reviewer: true }, // CR-109 · engine đã nhận "Từ chối" của người duyệt ⇒ ghi HĐ bị từ chối
      ),
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
    const inp = await input(d, who, st);
    const plan = planEngineAct({
      ...inp,
      action: b.action,
      feedback: b.feedback,
      hasSource: st.hasSource,
    });
    if (plan.kind === "error") return { error: plan.code };
    if (b.expect && b.expect.taskId !== plan.taskId) return { error: "APPROVAL_NOT_OPEN" };
    const c = { who, id, st, runId: a.engineRunId, b };
    const note = plan.kind !== "redo" ? await noteOverride(d, c, inp.sv, plan.taskId) : null;
    if (note?.id) return execOrVoid(d, port, c, plan, note.id);
    const out = await exec(d, port, c, plan);
    // W1 · hai lần bấm song song của CÙNG người: lần chèn bản ghi thua đua (bù trừ xoá) còn lần trùng (không chèn) thắng ⇒ ghi
    // lại sau khi engine nhận quyết (idempotent, `on conflict do nothing`) — quyết duyệt thay không bao giờ thiếu audit.
    if (out === "ok") await afterOk(d, c, inp.sv, plan, note);
    return out;
  };
}

/** Engine đã nhận quyết: ghi lại "duyệt thay" nếu thua đua (idempotent) + nhật ký quyết định (CR-125). */
async function afterOk(
  d: EngineCardDeps,
  c: Ctx,
  sv: Awaited<ReturnType<typeof input>>["sv"],
  plan: Plan,
  note: unknown,
): Promise<void> {
  // W1 · hai lần bấm song song của CÙNG người: lần chèn bản ghi thua đua (bù trừ xoá) còn lần trùng (không chèn) thắng.
  if (note) await noteOverride(d, c, sv, plan.taskId);
  if (plan.kind !== "redo") await noteDecision(d, c, sv, plan);
}

/** CR-125 · mỗi quyết định thật của người duyệt (Đạt / Trả lại / Từ chối) ⇒ một dòng lịch sử HĐ: ai · bước · kết quả · góp ý. Engine đã
 *  nhận quyết rồi nên lỗi ghi chỉ cảnh báo (không đổi kết quả của người bấm). */
async function noteDecision(
  d: EngineCardDeps,
  c: Ctx,
  sv: Awaited<ReturnType<typeof input>>["sv"],
  plan: Plan,
): Promise<void> {
  const step = sv?.steps.find((s) => s.task?.id === plan.taskId);
  const aid = (c.st.approval as NonNullable<ApprovalState["approval"]>).id;
  const action = plan.kind === "pass" ? "approve" : plan.kind === "reject" ? "reject" : "return";
  const e = {
    taskId: plan.taskId,
    stageKey: step?.key ?? "",
    action,
    feedback: c.b.feedback?.trim() ? c.b.feedback.trim().slice(0, 1000) : null,
    actor: c.who.userId,
  } as const;
  await d.uow
    .tenant(c.who, async (r) => r.approvalEngine.recordDecision?.(c.id, aid, e))
    .catch(() => d.warn?.("contract-approval-decision-log-failed", { contract_id: c.id }));
}

/** Review · engine không nhận (not_open / đua / lỗi) ⇒ bù trừ: xoá ĐÚNG bản ghi vừa chèn (lịch sử không hiện duyệt thay giả). */
async function execOrVoid(
  d: EngineCardDeps,
  port: ApprovalEnginePort,
  c: Ctx,
  plan: Plan,
  ev: string,
): Promise<EngineActResult> {
  const undo = () =>
    d.uow
      .tenant(c.who, async (r) => r.approvalEngine.voidOverride?.(ev))
      .catch(() => d.warn?.("contract-approval-override-void-failed", { contract_id: c.id }));
  const out = await exec(d, port, c, plan).catch(async (e: unknown) => {
    await undo();
    throw e;
  });
  if (out !== "ok") await undo();
  return out;
}

/** CR-113 (review) · người quyết chỉ có quyền nhờ Toàn quyền ⇒ ghi "duyệt thay" (`contract_events` `approval_override`) TRƯỚC khi
 *  engine nhận quyết (write-ahead, tx gói, idempotent theo lượt × task × người): ghi lỗi ⇒ ném, KHÔNG quyết ⇒ không bao giờ có
 *  quyết duyệt thay thiếu audit. Engine từ chối sau đó (đua) ⇒ bản ghi chỉ là lần bấm; thẻ chỉ hiện `owner_override` khi người
 *  quyết của task = người ghi (`decidedAsOf`). */
async function noteOverride(
  d: EngineCardDeps,
  c: Ctx,
  sv: Awaited<ReturnType<typeof input>>["sv"],
  taskId: string,
) {
  const step = sv?.steps.find((s) => s.task?.id === taskId);
  if (step?.task?.override !== true) return null;
  const aid = (c.st.approval as NonNullable<ApprovalState["approval"]>).id;
  const ev = {
    runId: c.runId,
    taskId,
    stageKey: step.key,
    action: c.b.action,
    actor: c.who.userId,
  };
  // `id` vừa chèn (bù trừ được); trùng lần bấm trước ⇒ `id: null` (không bù trừ bản ghi cũ) nhưng vẫn là duyệt thay.
  const id =
    (await d.uow.tenant(c.who, async (r) => r.approvalEngine.recordOverride?.(c.id, aid, ev))) ??
    null;
  return { id };
}

type Plan = Exclude<ReturnType<typeof planEngineAct>, { kind: "error" }>;

/** Đạt duyệt cuối ⇒ GIỮ chỗ + ghi `pending_links` (kể cả null) TRONG tx gói TRƯỚC khi act (tool finalize áp cùng tx khoá) — không để
 *  SP sót của lần Đạt trước. CR-107 · chỗ giữ gắn (lần bấm, người, task): người thứ hai Đạt cùng task bị chặn TRƯỚC act
 *  (APPROVAL_NOT_OPEN) ⇒ không ghi đè SP của người đang quyết; act thất bại / not_open ⇒ trả chỗ theo đúng lần bấm (so-rồi-xoá). */
async function pass(d: EngineCardDeps, port: ApprovalEnginePort, c: Ctx, p: Plan) {
  const a = c.st.approval as NonNullable<ApprovalState["approval"]>;
  if (p.kind !== "pass" || !p.finalizes)
    return decide(port, c, { task_id: p.taskId }, { result: "pass" });
  const own = { claim: crypto.randomUUID(), by: c.who.userId, task: p.taskId };
  const save = (op: { links: readonly unknown[] | null } | { release: true }) =>
    d.uow.tenant(c.who, (r) => r.approvalEngine.setPendingLinks(a.id, c.runId, { ...own, ...op }));
  const release = () => save({ release: true }).catch(() => false);
  const links = c.b.products?.length ? c.b.products : null;
  if (!(await save({ links }))) return { error: "APPROVAL_NOT_OPEN" as const };
  const out = await decide(port, c, { task_id: p.taskId }, { result: "pass" }).catch(
    async (e: unknown) => {
      await release();
      throw e;
    },
  );
  if (out !== "ok") await release();
  return out;
}
/** CR-121 F-5 · TRƯỚC khi Đạt: đưa dữ liệu HĐ hiện tại (đã "Xác nhận và lưu" / sửa ở bước 0) vào input run — mẫu Thông báo
 *  ({ma_hd}, {ten_hd}, {gia_tri}), ngày Chờ tới, input Dify của bước sau dùng số đã xác nhận, không phải số lúc mở run. CAS theo
 *  `contracts.version` ở engine (bản cũ không đè bản mới). Quy trình không có bước đọc input HĐ ⇒ 0 SQL. Lỗi ⇒ chỉ cảnh báo (input
 *  cũ vẫn chạy được, không chặn duyệt). Điều kiện rẽ không đọc input (tool rẽ dựng dữ kiện từ HĐ hiện tại). */
async function refreshInputs(d: EngineCardDeps, port: ApprovalEnginePort, c: Ctx): Promise<void> {
  const steps = c.st.approval?.flowSteps ?? [];
  if (!port.updateInputs || !usesContractInputs(steps)) return;
  try {
    const f = await d.uow.tenant(c.who, async (r) => r.approvalEngine.difyFacts?.(c.id) ?? null);
    if (!f || f.version === undefined) return;
    const ref = { tenantId: c.who.tenantId, runId: c.runId, pack: "contracts", recordId: c.id };
    await port.updateInputs({ ...ref, version: f.version }, contractRunInputs(steps, f));
  } catch {
    d.warn?.("contract-approval-inputs-refresh-failed", { contract_id: c.id, run_id: c.runId });
  }
}

async function exec(
  d: EngineCardDeps,
  port: ApprovalEnginePort,
  c: Ctx,
  p: Plan,
): Promise<EngineActResult> {
  if (p.kind === "pass") {
    await refreshInputs(d, port, c);
    return pass(d, port, c, p);
  }
  if (p.kind === "reject") return reject(d, port, c, p.taskId);
  if (p.kind === "redo") return p.reextract ? redo(d, port, c) : "ok";
  const fb = c.b.feedback ? { feedback: c.b.feedback } : {};
  // fail_back: lùi về `backTo` (thẻ máy cũ = bước soạn 0; flow theo sự kiện = đích trong back_to_steps); fail_flow: nhánh Trả lại của stage.
  const back = p.kind === "fail_back" ? { back_to_step: p.backTo } : {};
  return decide(port, c, { task_id: p.taskId }, { result: "fail", ...fb, ...back });
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
