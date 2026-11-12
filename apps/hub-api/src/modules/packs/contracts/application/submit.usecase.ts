// CR-127 K3 · BR-02/03/04/36a · spec §3 (#3, #4, #8, #16), §4.1: Gửi (có quy trình khớp ⇒ PROCESSING + `contract.submitted`; không ⇒ NF1: CHẶN
// `NO_APPROVAL_FLOW`, HĐ giữ DRAFT, không ghi lượt/sự kiện — người dùng chốt 2026-11-10)
// · Gửi lại (= Gửi khi `submit_round > 0`, lượt mới từ bước đầu; hồ sơ giữ mọi lượt cũ) · Rút về (chỉ người gửi; bước hiện tại chưa có quyết
// định/phiếu — Nhận việc KHÔNG chặn; báo người đã nhận) · Tạo lại từ HĐ bị từ chối. Đổi trạng thái chỉ qua cổng `applyTransition`; việc kèm
// theo đi theo `sideEffects` của luật. "Có quy trình khớp" hỏi engine (`FlowAvailability`, kit) — không đọc cờ `FLOW_TRIGGERS`/`approval_on()`.
import type { EvidenceInput } from "@ai/contracts/chat";
import type { FlowEngine, FlowOutline, FlowRunStep, PackUow, PackWho } from "../../kit/public";
import type { ContractStateRepo } from "../adapters/contract-state.repo";
import type { SubmissionsRepo } from "../adapters/submissions.repo";
import { CONTRACTS_PACK, EV_SUBMITTED } from "../domain/contract-flow-events.rules";
import { transition } from "../domain/contract-state.rules";
import type { ContractFlowGate, ContractFlowRepo } from "./contract-flow.ports";

export type SubmitTxRepos = {
  sub: SubmissionsRepo;
  st: ContractStateRepo;
  contractFlow: ContractFlowRepo;
};
export type SubmitErr =
  | "not_found"
  | "forbidden"
  | "CONTRACT_NOT_DRAFT"
  | "EXTRACT_NOT_READY"
  | "FILE_REQUIRED"
  | "UNCHANGED_REASON_REQUIRED"
  | "STATE_CONFLICT"
  | "NO_APPROVAL_FLOW";
export type SubmitOk = { status: "processing" | "done"; no_flow: boolean; round: number };
export type SubmitOpts = {
  unchangedReason?: string | undefined;
  evidence?: EvidenceInput | undefined;
  /** SP chọn lúc "Xác nhận & lưu" — có quy trình ⇒ giữ ở lượt (`pending_links`), gắn khi Đã duyệt. */
  links?: unknown;
  /** Route API kiểm vai (người tạo ∪ phụ trách); "Xác nhận & lưu" ở màn xác nhận dùng quyền ghi có sẵn. */
  checkRole: boolean;
};
export type SubmitDeps = { gate: ContractFlowGate; engine: () => FlowEngine | null };

type Head = NonNullable<Awaited<ReturnType<SubmitTxRepos["sub"]["lock"]>>>;

/** Kiểm trước khi gửi (thứ tự = ưu tiên mã lỗi). */
function precheck(h: Head, who: PackWho, o: SubmitOpts): SubmitErr | null {
  if (o.checkRole && h.createdBy !== who.userId && h.ownerId !== who.userId) return "forbidden";
  if (h.status !== "draft") return "CONTRACT_NOT_DRAFT";
  if (h.extractState !== "ready") return "EXTRACT_NOT_READY";
  if (h.needsFile) return "FILE_REQUIRED";
  if (h.round > 0 && h.same && !o.unchangedReason && !o.evidence)
    return "UNCHANGED_REASON_REQUIRED";
  return null;
}

/** Câu hỏi chọn quy trình theo dữ kiện HIỆN TẠI trong tx (thấy cả trường vừa lưu) + phòng ban người gửi — MỘT nguồn cho Gửi và xem trước. */
async function flowQuery(r: SubmitTxRepos, who: PackWho, id: string, d: SubmitDeps) {
  const prep = await d.gate.prepare(who.tenantId, who.userId);
  const departments = prep.departments ?? [];
  const facts: Record<string, unknown> = { ...((await r.contractFlow.readFacts(id))?.facts ?? {}) };
  if (departments.length > 0) {
    facts.creator_department = departments;
    facts.submitter_group_ids = departments;
  }
  const q = {
    tenantId: who.tenantId,
    app: CONTRACTS_PACK,
    event: EV_SUBMITTED,
    facts: facts as never,
  };
  return { q, departments, eng: d.engine() };
}

/** "Có quy trình khớp" theo dữ kiện hiện tại. */
async function flowOf(r: SubmitTxRepos, who: PackWho, id: string, d: SubmitDeps) {
  const { q, departments, eng } = await flowQuery(r, who, id, d);
  const hasFlow = eng ? await eng.availability.hasFlowFor(null, q) : false;
  return { hasFlow, departments };
}

/** Hồ sơ lần gửi (+ bằng chứng "Gửi lại không đổi"). */
async function recordOf(
  r: SubmitTxRepos,
  who: PackWho,
  id: string,
  h: Head,
  o: SubmitOpts,
  noFlow: boolean,
) {
  const unchanged = h.round > 0 && h.same;
  if (unchanged && o.evidence) await r.sub.evidence(id, o.evidence);
  await r.sub.record(id, {
    round: h.round + 1,
    actor: who.userId,
    fields: h.fields,
    textSha: h.textSha,
    sourceText: h.last && h.last.textSha === h.textSha ? null : h.sourceText,
    returnNote: h.returnNote,
    unchangedReason: unchanged ? (o.unchangedReason ?? o.evidence?.note ?? null) : null,
    noFlow,
  });
}

/** Trong tx gói đã mở: khoá HĐ → kiểm → (có quy trình?) → cổng → việc kèm theo (`sideEffects` của luật). */
export async function submitInTx(
  r: SubmitTxRepos,
  who: PackWho,
  id: string,
  o: SubmitOpts,
  d: SubmitDeps,
): Promise<SubmitOk | { error: SubmitErr }> {
  const h = await r.sub.lock(id);
  if (!h) return { error: "not_found" };
  const bad = precheck(h, who, o);
  if (bad) return { error: bad };
  const { hasFlow, departments } = await flowOf(r, who, id, d);
  // NF1 · chưa có quy trình duyệt khớp ⇒ chặn TRƯỚC mọi câu ghi (HĐ giữ DRAFT, không lượt / hồ sơ / sự kiện).
  if (!hasFlow) return { error: "NO_APPROVAL_FLOW" };
  const plan = transition("draft", "submit", { hasFlow });
  if ("error" in plan) return { error: "STATE_CONFLICT" };
  const aid = await r.sub.openFlowLot(id, who.userId, o.links ?? null); // NF1: tới đây luôn có quy trình ⇒ luôn mở lượt
  const g = await r.st.applyTransition({
    contractId: id,
    ev: "submit",
    actorId: who.userId,
    ctx: { hasFlow },
    runId: aid,
  });
  if (!g.ok) throw new SubmitRollback("STATE_CONFLICT");
  const fx = new Set(plan.sideEffects);
  if (fx.has("record_submission")) await recordOf(r, who, id, h, o, fx.has("event_no_flow"));
  // FIX-Z3 · khoá sự kiện theo LẦN GỬI (`<lượt>.r<submit_round>`), không chỉ theo lượt: lượt có thể được dùng lại (lượt sống còn sót khi
  // HĐ về Nháp không qua cổng đóng lượt) ⇒ khoá cũ trùng ⇒ `emit_flow_event` bỏ ⇒ HĐ kẹt processing. Bấm 2 lần đã chặn bởi CAS draft.
  if (fx.has("emit_submitted"))
    await r.contractFlow.emitContract(EV_SUBMITTED, id, `${aid}.r${h.round + 1}`, {
      actor: who.userId,
      departments,
    });
  return { status: "processing", no_flow: false, round: h.round + 1 };
}

/** NF1 · `submit_block` của chi tiết HĐ: CÙNG `flowOf` với lệnh Gửi (một nguồn) — true = Gửi sẽ có quy trình khớp. Chỉ chi tiết (không N+1). */
export function submitFlowOpen(d: SubmitDeps & { uow: PackUow<SubmitTxRepos> }) {
  return (who: PackWho, id: string): Promise<boolean> =>
    d.uow.tenant(who, async (r) => (await flowOf(r, who, id, d)).hasFlow);
}

export type SubmitPreview =
  | { error: "not_found" | "forbidden" | "CONTRACT_NOT_DRAFT" }
  | { block: "no_flow"; flowName: null; steps: readonly [] }
  | { block?: undefined; flowName: string; steps: FlowOutline["steps"] };

/**
 * CR-127 · M4 · xem trước "các bước HĐ sẽ đi qua nếu Gửi bây giờ". Quyền như Gửi (người tạo ∪ phụ trách); HĐ phải còn DRAFT. CÙNG câu hỏi
 * chọn quy trình với Gửi (`flowQuery` + `hasFlowFor`): không khớp ⇒ `block: 'no_flow'` (Gửi sẽ bị chặn NF1). Chỉ đọc — không khoá, không ghi.
 */
async function previewTx(
  r: SubmitTxRepos,
  who: PackWho,
  id: string,
  d: SubmitDeps,
): Promise<SubmitPreview> {
  const h = await r.sub.lock(id, { forUpdate: false });
  if (!h) return { error: "not_found" };
  if (h.createdBy !== who.userId && h.ownerId !== who.userId) return { error: "forbidden" };
  if (h.status !== "draft") return { error: "CONTRACT_NOT_DRAFT" };
  const { q, eng } = await flowQuery(r, who, id, d);
  const open = eng ? await eng.availability.hasFlowFor(null, q) : false;
  const o = open ? await eng?.availability.outline?.(q, { starterId: who.userId }) : null;
  return o ? { flowName: o.flowName, steps: o.steps } : NO_FLOW;
}
const NO_FLOW = { block: "no_flow", flowName: null, steps: [] } as const;

export function submitPreview(d: SubmitDeps & { uow: PackUow<SubmitTxRepos> }) {
  return (who: PackWho, id: string): Promise<SubmitPreview> =>
    d.uow.tenant(who, (r) => previewTx(r, who, id, d));
}

/** Lỗi phát hiện SAU khi đã ghi (cổng thua đua) ⇒ ném để ROLLBACK cả tx, đổi thành kết quả ở biên. */
export class SubmitRollback extends Error {
  constructor(readonly code: SubmitErr) {
    super(code);
  }
}

export function submitContract(d: SubmitDeps & { uow: PackUow<SubmitTxRepos> }) {
  return (who: PackWho, id: string, o: Omit<SubmitOpts, "checkRole">) =>
    d.uow
      .tenant(who, (r) => submitInTx(r, who, id, { ...o, checkRole: true }, d))
      .catch((e) => {
        if (e instanceof SubmitRollback) return { error: e.code };
        throw e;
      });
}

export type WithdrawOut =
  | { status: "draft" }
  | { error: "not_found" | "STATE_CONFLICT" }
  | {
      error: "WITHDRAW_NOT_ALLOWED";
      why: "not_submitter" | "step_decided" | "not_processing";
      by?: string | null;
      step?: number;
    };

type Engine = FlowEngine | null;
type WithdrawCtx = { step: FlowRunStep | null; runId: string | null };

/** Trong tx: kiểm 3 lý do (Nhận việc KHÔNG chặn) → cổng processing → draft → đóng lượt `cancelled`. */
async function withdrawTx(
  r: SubmitTxRepos,
  who: PackWho,
  id: string,
  reason: string,
  x: { eng: Engine; ctx: WithdrawCtx },
): Promise<WithdrawOut> {
  const h = await r.sub.lock(id);
  if (!h) return { error: "not_found" };
  if (h.status !== "processing") return { error: "WITHDRAW_NOT_ALLOWED", why: "not_processing" };
  if (h.submittedBy !== who.userId) return { error: "WITHDRAW_NOT_ALLOWED", why: "not_submitter" };
  const lot = await r.sub.engineRunOf(id);
  x.ctx.runId = lot?.engineRunId ?? null;
  if (x.ctx.runId && x.eng)
    x.ctx.step = await x.eng.runControl.inspect({ tenantId: who.tenantId, runId: x.ctx.runId });
  const decided = x.ctx.step?.decided;
  if (decided)
    return {
      error: "WITHDRAW_NOT_ALLOWED",
      why: "step_decided",
      by: decided.by,
      step: decided.stageIdx,
    };
  const g = await r.st.applyTransition({
    contractId: id,
    ev: "withdraw",
    actorId: who.userId,
    reason,
    runId: lot?.approvalId ?? null,
  });
  if (!g.ok) return { error: "STATE_CONFLICT" };
  await r.sub.closeLot(id, "cancelled", who.userId, reason.slice(0, 4000));
  return { status: "draft" };
}

/** #8 · Rút về: cổng + đóng lượt trong tx; SAU COMMIT huỷ lượt engine (hook lượt cũ tự bỏ qua) + báo người đã nhận việc (R#26). */
export function withdrawContract(d: { uow: PackUow<SubmitTxRepos>; engine: () => Engine }) {
  return async (who: PackWho, id: string, reason: string): Promise<WithdrawOut> => {
    const eng = d.engine();
    const ctx: WithdrawCtx = { step: null, runId: null };
    const out = await d.uow.tenant(who, (r) => withdrawTx(r, who, id, reason, { eng, ctx }));
    if ("status" in out && ctx.runId && eng)
      await eng.runControl.cancel({
        tenantId: who.tenantId,
        runId: ctx.runId,
        actorId: who.userId,
        reason,
        notify: ctx.step?.claimers ?? [],
      });
    return out;
  };
}

/** #16 · Tạo lại từ HĐ bị từ chối (người tạo ∪ phụ trách). */
export function recreateContract(d: { uow: PackUow<SubmitTxRepos> }) {
  return (who: PackWho, id: string) =>
    d.uow.tenant(
      who,
      async (
        r,
      ): Promise<
        { id: string } | { error: "not_found" | "forbidden" | "CONTRACT_NOT_REJECTED" }
      > => {
        const h = await r.sub.lock(id);
        if (!h) return { error: "not_found" };
        if (h.createdBy !== who.userId && h.ownerId !== who.userId) return { error: "forbidden" };
        if (h.status !== "reject") return { error: "CONTRACT_NOT_REJECTED" };
        const nid = await r.sub.recreate(id, who.userId);
        return nid ? { id: nid } : { error: "CONTRACT_NOT_REJECTED" };
      },
    );
}
