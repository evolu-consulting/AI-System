// contract-flow S3a · duyệt HĐ chạy trên engine quy trình (cr121-a2: mọi lượt mới, không cờ/env). Lớp 2: chỉ cổng.
// - `startEngineApproval`: chỗ mở duyệt cấp 1 (sau AI đọc / nhập tay) ⇒ đồng bộ def theo version mẫu (`ensureDef`) → mở run có
//   `ref {pack:'contracts', record_id}` (COMMIT, chưa kick) → tx gói gắn run vào lượt (`mode='engine'`, `engine_run_id`,
//   `flow_version`, `flow_steps`) → kick; gắn hụt ⇒ huỷ bù. CR-107 · mẫu không mở được (thiếu Group / hỏng / không có) ⇒ lượt KẸT
//   `mode='engine'` + lý do (`markStalled`), KHÔNG về máy cũ; cr121-a2 · engine vắng / ném cũng ⇒ lượt kẹt `ENGINE_RUN_FAILED`.
// - `routeStep` (tool `contracts-route`) / `finalizeRun` (tool `contracts-finalize`): chạy trong tx gói của tenant run, CHỈ chạm HĐ có
//   `engine_run_id = ctx.processRunId`. Finalize kiểm lại stage đã Đạt phủ đủ bước bắt buộc theo giá trị HIỆN TẠI (khoá HĐ) + mẫu
//   chụp, ghi "Đã duyệt" (`confirmed_by` = người Đạt gần nhất) rồi áp `pending_links` CÙNG tx — lỗi gắn SP ⇒ ROLLBACK, không khoá.
//   CR-107 · lỗi logic của tool ném `PackToolBusinessError` ⇒ engine không thử lại (needs_decision ngay).
// Mở lại / Thử lại / Huỷ & mở lại: `approval-engine-reopen.usecase.ts`.
import type { PackWho } from "../../kit/application/ports";
import { PackToolBusinessError } from "../../kit/domain/pack-tool-error";
import { PACK_OWNER_GROUP_KEY } from "../domain/approval-def.rules";
import {
  ENGINE_START_FAILED,
  engineStartable,
  FLOW_INVALID,
  FLOW_MISSING,
  factsOf,
  finalizeReady,
  groupMissingReason,
  noRunStalled,
  routeFrom,
} from "../domain/approval-engine.rules";
import {
  APPROVAL_PROCESS_KEY,
  compileDef,
  difyRunInputs,
  difySelectBindings,
  engineSteps,
  flowGroupIds,
  hasDifyStep,
  routeNext,
} from "../domain/approval-flow.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import { type FlowFacts, factNeedsOf } from "../domain/approval-flow-cond.rules";
import { hasNotifyOrWait, notifyRunInputs } from "../domain/approval-flow-notify.rules";
import { escalateOrder } from "../domain/approval-owner.rules";
import type {
  ApprovalEngineBridge,
  ApprovalEnginePort,
  ApprovalEngineTxRepos,
  ApprovalEngineUow,
  CreatorDepartments,
  EngineCaller,
  EngineRunRow,
  EngineStartRow,
} from "./approval-engine.ports";
import {
  defVersionOf,
  type EngineFlow,
  type OpenRunArgs,
  slotFlowOf,
  slotRunOf,
} from "./approval-engine-slot";
import type { FlowGroups } from "./approval-flow.usecase";
import type { ProductLinksRepo } from "./product-links.usecase";

export type ApprovalEngineDeps = {
  bridge: ApprovalEngineBridge;
  uow: ApprovalEngineUow;
  /** CR-121 D-1 · `creatorDepartments` (tuỳ chọn) nối kèm nguồn Group lúc mount; vắng ⇒ điều kiện phòng ban chưa có dữ liệu. */
  groups: FlowGroups & { creatorDepartments?: CreatorDepartments | undefined };
  warn: (msg: string, meta: Record<string, unknown>) => void;
  /** esign-flow · sau khi ghi "Đã duyệt" (đã COMMIT): chạy bước Ký số của mẫu chụp. Vắng ⇒ không có bước ký tự động. */
  afterApproved?: ((tenantId: string, contractId: string) => Promise<unknown>) | undefined;
};
/** Danh tính lời gọi tool (cấu trúc khớp `PackToolCtx`). */
export type EngineToolCtx = { tenantId: string; userId: string; processRunId?: string | null };
export type EngineStartOutcome = "started" | "skipped" | "stalled";

/** Cổng engine dùng ở đây (ensureDef/start/cancel) không xét vai trò; người gọi = người mở duyệt. */
export const callerOf = (who: PackWho): EngineCaller => ({ ...who, role: "member" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
/** prod-fix · trường log của lỗi engine: tên + `code` (AppError của engine, vd `TOO_MANY_PROCESS_RUNS`) + câu ngắn CHỈ khi có mã
 *  (câu của AppError là câu cố định theo mã; lỗi khác — vd lỗi SQL kèm tham số — không ghi câu). */
export function engineErrMeta(e: unknown): Record<string, string> {
  if (!(e instanceof Error)) return { error: "unknown" };
  const code = (e as { code?: unknown }).code;
  if (typeof code !== "string" || !CODE.test(code)) return { error: e.name };
  return { error: e.name, code, message: e.message.slice(0, 120) };
}
/** Mẫu mở run, hoặc lý do không mở được (CR-107 · `FLOW_GROUP_MISSING:<mã>` / `FLOW_INVALID` / `FLOW_MISSING`). */
export type FlowOrInvalid = EngineFlow | { invalid: string };
export type Compiled = { def: Record<string, unknown> } | { invalid: string };

/** prod-fix2 · Group "Toàn quyền" của gói còn ở tenant: Group cấp 2 của cài đặt + Group vai owner (quyền gói `admin`).
 *  CR-113 (review) · MỘT thứ tự xác định (`escalateOrder`: owner trước, rồi cấp 2) cho cả Group gắn task của bước chỉ có người
 *  cụ thể (`reviewGroupOf`), đích chuyển cấp mặc định và preview `GET /approval-flow` — không phụ thuộc thứ tự Map của `idsOf`. */
async function ownerGroupIds(
  d: ApprovalEngineDeps,
  who: PackWho,
): Promise<{ owners: string[]; escalateTo: string[] }> {
  const s = await d.uow.tenant(who, (r) => r.approvalFlow.settings());
  const ids = await d.groups.idsOf(who.tenantId, [s.level2GroupKey, PACK_OWNER_GROUP_KEY]);
  const order = escalateOrder(ids, s.level2GroupKey);
  return { owners: order, escalateTo: order };
}

/** Def theo mẫu; Group mẫu trỏ không còn ở tenant / workflow Dify đã gỡ ⇒ lý do (lượt kẹt, không về máy cũ). */
export async function compiled(
  d: ApprovalEngineDeps,
  who: PackWho,
  f: FlowOrInvalid,
): Promise<Compiled> {
  if ("invalid" in f) return f;
  const tenantId = who.tenantId;
  const [have, { owners, escalateTo }] = await Promise.all([
    d.groups.existingIds(tenantId, flowGroupIds(f.steps)),
    ownerGroupIds(d, who),
  ]);
  // cf-dify · bước Dify: tham số workflow lấy từ catalog hiện hành của tenant (workflow đã gỡ ⇒ compile ném).
  const catalog = hasDifyStep(f.steps) ? ((await d.bridge.port?.workflowsOf(tenantId)) ?? []) : [];
  try {
    const def = compileDef(
      f,
      new Set([...have, ...owners]),
      new Map(catalog.map((w) => [w.key, w])),
      owners,
      escalateTo,
    );
    return { def: def as unknown as Record<string, unknown> };
  } catch (e) {
    const gm = e instanceof Error && e.message === "approval-flow-group-missing";
    return { invalid: gm ? groupMissingReason([]) : FLOW_INVALID };
  }
}

/** Mẫu hiện hành của tenant + trạng thái lượt của HĐ (một tx). `ok` quyết lượt có mở/mở lại được không. Trả thêm NGƯỜI BẮT ĐẦU
 *  của lượt: run luôn mở dưới người này (không phải người kích job / bấm Đọc lại). */
export async function loadStart(
  d: ApprovalEngineDeps,
  who: PackWho,
  id: string,
  ok: (st: EngineStartRow) => boolean = engineStartable,
) {
  const st = await d.uow.tenant(who, async (r) => {
    const s = await r.approvalEngine.startState(id);
    return s?.startedBy && ok(s) ? s : null;
  });
  if (!st) return null;
  // CR-105 · tra khe theo tenant mỗi lần mở lượt (gán ⇒ mặc định ⇒ bản xuất bản). CR-118 §11.2 · theo luật phòng ban của
  // NGƯỜI BẮT ĐẦU lượt (không phải người kích job / Đọc lại).
  // cr118-route-kind · + loại HĐ (`deal`) cho điều kiện luật.
  const slot = await slotFlowOf(d, who.tenantId, st.startedBy, st.deal);
  // CR-107 · khe không có bản áp được ⇒ `FLOW_MISSING` (không còn đường máy 2 bước cũ).
  const flow: FlowOrInvalid = slot ?? { invalid: FLOW_MISSING };
  return { flow, starter: st.startedBy as string, st };
}

/** CR-107 · lượt KẸT với lý do (chưa có run ⇒ `mode='engine'`; `run` ⇒ đúng run đó). Ghi có điều kiện; không thấy ⇒ false. */
export async function markStalled(
  d: Pick<ApprovalEngineDeps, "uow" | "warn">,
  who: PackWho,
  c: { id: string; approvalId: string | null; run: string | null; reason: string },
): Promise<boolean> {
  const aid = c.approvalId;
  if (!aid) return false;
  const ok = await d.uow.tenant(who, (r) =>
    r.approvalEngine.markStalled(c.id, aid, { runId: c.run, reason: c.reason }),
  );
  d.warn("contract-engine-flow-stalled", { contract_id: c.id, reason: c.reason, marked: ok });
  return ok;
}

/** Mở run (COMMIT, chưa kick) → gắn vào lượt dưới RLS → kick; gắn hụt (đua / lượt đã đổi) ⇒ huỷ bù. */
export async function openRun(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  c: OpenRunArgs,
): Promise<"started" | "skipped"> {
  // started_by của run = người bắt đầu lượt duyệt (exclude_starter phải còn nghĩa sau Đọc lại / heal do người khác kích).
  const u = callerOf({ tenantId: who.tenantId, userId: c.starter });
  // CR-121 D-6 · Thông báo / Chờ tới cũng cần dữ liệu HĐ (cùng một câu đọc với Dify).
  const notifyWait = hasNotifyOrWait(c.flow.steps);
  const facts =
    hasDifyStep(c.flow.steps) || notifyWait
      ? await d.uow.tenant(who, (r) => r.approvalEngine.difyFacts(c.id))
      : null;
  // dify-input-map · tham số `select` lấy từ loại HĐ ⇒ input run phụ theo catalog hiện hành (một lần gọi, không theo hàng).
  const selects = facts
    ? difySelectBindings(c.flow.steps, await port.workflowsOf(who.tenantId))
    : [];
  const req = {
    process_key: APPROVAL_PROCESS_KEY,
    input: c.id,
    inputs: [
      { type: "text" as const, key: "contract-id", text: c.id },
      ...(facts ? difyRunInputs(facts, selects) : []),
      ...(facts && notifyWait
        ? notifyRunInputs({
            number: facts.number ?? null,
            owner: facts.owner ?? null,
            endDate: facts.endDate ?? null,
            actionDeadline: facts.actionDeadline ?? null,
          })
        : []),
    ],
    ref: { pack: "contracts", record_id: c.id },
    ...slotRunOf(c.flow, c.def, port),
  };
  const { runId, kick } = await port.start(u, req);
  let attached = false;
  try {
    attached = await d.uow.tenant(who, async (r) => {
      const st = await r.approvalEngine.startState(c.id);
      // CR-107 · lượt kẹt chưa có run (`noRunStalled`) gắn như lượt mới (mở lại sau khi bổ sung Group).
      const ok = c.replaces
        ? stalledRef(st, c.replaces)
        : !!st && (engineStartable(st) || noRunStalled(st));
      if (!st?.approvalId || !ok) return false;
      const a = {
        runId,
        version: c.flow.version,
        steps: c.flow.steps,
        replaces: c.replaces ?? null,
      };
      return r.approvalEngine.attach(c.id, st.approvalId, a);
    });
  } finally {
    if (!attached)
      await port
        .cancel(u, runId)
        .catch(() => d.warn("contract-engine-cancel-failed", { run_id: runId }));
  }
  if (!attached) return "skipped";
  await kick().catch(() => d.warn("contract-engine-kick-failed", { run_id: runId }));
  return "started";
}

/** cr121-a2 · engine chưa gắn / ném lúc mở ⇒ lượt KẸT `ENGINE_RUN_FAILED` (mode='engine', chưa run — UI "gặp lỗi, chờ mở lại"),
 *  KHÔNG về máy cũ. Ghi có điều kiện (`engine_run_id is null`): đua với lần mở khác đã gắn run ⇒ không ghi. Không ném. */
async function stallStart(d: ApprovalEngineDeps, who: PackWho, id: string) {
  try {
    const st = await d.uow.tenant(who, (r) => r.approvalEngine.startState(id));
    if (!st?.approvalId || !engineStartable(st)) return "skipped" as const;
    const c = { id, approvalId: st.approvalId, run: null, reason: ENGINE_START_FAILED };
    return (await markStalled(d, who, c)) ? ("stalled" as const) : ("skipped" as const);
  } catch (e) {
    d.warn("contract-engine-stall-failed", { contract_id: id, ...engineErrMeta(e) });
    return "skipped" as const;
  }
}

/** Gọi SAU khi lượt duyệt vào `level1` (đã COMMIT). Không ném: lỗi engine ⇒ log + lượt kẹt; mẫu không mở được ⇒ lượt kẹt. */
export function startEngineApproval(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<EngineStartOutcome> => {
    const port = d.bridge.port;
    if (!port) {
      d.warn("contract-engine-start-failed", { contract_id: id, error: "engine_unavailable" });
      return stallStart(d, who, id);
    }
    try {
      const got = await loadStart(d, who, id);
      if (!got) return "skipped";
      const { flow, starter } = got;
      const c = await compiled(d, who, flow);
      if ("invalid" in c || "invalid" in flow) {
        const reason = "invalid" in c ? c.invalid : FLOW_INVALID;
        await markStalled(d, who, { id, approvalId: got.st.approvalId, run: null, reason });
        return "stalled";
      }
      const def = c.def;
      await port.ensureDef(callerOf(who), APPROVAL_PROCESS_KEY, def, defVersionOf(flow, def, port));
      return await openRun(d, port, who, { id, flow, starter, def });
    } catch (e) {
      d.warn("contract-engine-start-failed", { contract_id: id, ...engineErrMeta(e) });
      return stallStart(d, who, id);
    }
  };
}

/** Lượt đang giữ đúng run `run` ở chế độ engine, còn `level1` (điều kiện mở lại). */
const stalledRef = (st: EngineStartRow | null, run: string): boolean =>
  st?.approvalStatus === "level1" && st.mode === "engine" && st.engineRunId === run;

/** Lời gọi phải thuộc một run (stage tool) và chỉ HĐ hợp lệ; sai ⇒ ném (`tool_failed`). `/mcp` (không run) ⇒ từ chối. */
function target(ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) {
  const id = String(args.contract_id ?? "");
  const run = ctx.processRunId ?? null;
  if (!run || !UUID.test(run) || !UUID.test(id))
    throw new PackToolBusinessError("contracts tool: not a run of this contract");
  return { id, run, who: { tenantId: ctx.tenantId, userId: ctx.userId } };
}
const inRun = (row: EngineRunRow | null, id: string): row is EngineRunRow =>
  row !== null && row.contractId === id;

/** CR-121 D-1 · nguồn dữ kiện mở rộng: `creatorDepartments` đi kèm `groups` (cùng nguồn Group của tenant, nối lúc mount). */
type FactsDeps = Pick<ApprovalEngineDeps, "uow"> & {
  groups?:
    | (Partial<FlowGroups> & { creatorDepartments?: CreatorDepartments | undefined })
    | undefined;
};

/** CR-121 D-1 · `new_partner` trong tx gói đang mở (MỘT câu, chỉ khi mẫu dùng; repo vắng ⇒ chưa có dữ liệu). */
const partnerIn = async (r: ApprovalEngineTxRepos, id: string, steps: readonly FlowStep[]) =>
  factNeedsOf(steps).partner && r.flowFacts ? r.flowFacts.newPartner(id) : null;

/** CR-121 D-1 · phòng ban người bắt đầu lượt (= danh tính run của tool) + phòng cha; NGOÀI tx gói. Không cần / không nối ⇒ null. */
async function departmentsOf(d: FactsDeps, who: PackWho, need: boolean) {
  const f = d.groups?.creatorDepartments;
  return need && f ? f(who.tenantId, who.userId) : null;
}

/** Dữ kiện đầy đủ theo giá trị HIỆN TẠI của HĐ (loại, giá trị từ hàng vừa đọc + phòng ban + đối tác mới). */
const fullFacts = (
  row: EngineRunRow,
  depts: readonly string[] | null,
  partner: boolean | null,
): FlowFacts => ({
  ...factsOf(row.deal, row.totalValue),
  creator_departments: depts,
  new_partner: partner,
});

/** Tool `contracts-route`: `next` = bước engine kế theo mẫu chụp + giá trị HIỆN TẠI của HĐ (CR-121 D-1 · + phòng ban người tạo,
 *  đối tác mới — đọc lại MỖI lần rẽ ⇒ sửa HĐ giữa lượt rẽ đúng). Câu SQL: byRun (1) + new_partner (0/1) + phòng ban (0/1). */
export function routeStep(d: FactsDeps) {
  return async (ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) => {
    const t = target(ctx, args);
    const got = await d.uow.tenant(t.who, async (r) => {
      const row = await r.approvalEngine.byRun(t.run, { lock: false });
      if (!inRun(row, t.id) || row.approvalStatus !== "level1") return null;
      return { row, partner: await partnerIn(r, t.id, row.flowSteps) };
    });
    if (!got) throw new PackToolBusinessError("contracts tool: contract not in run");
    const steps = engineSteps(got.row.flowSteps); // esign-flow · bước Ký số không là stage engine
    const from = routeFrom(args.from_step, steps.length);
    if (from === null) throw new PackToolBusinessError("contracts tool: bad from_step");
    const depts = await departmentsOf(d, t.who, factNeedsOf(steps).departments);
    return { next: routeNext(steps, fullFacts(got.row, depts, got.partner), from) };
  };
}

type Links = Parameters<ProductLinksRepo["link"]>[1];
type Target = ReturnType<typeof target>;

/** Gắn SP chờ (không strict — trong tx vừa ghi "Đã duyệt"); lỗi ⇒ ném ⇒ ROLLBACK cả bước (HĐ không khoá). */
async function applyPendingLinks(
  r: ApprovalEngineTxRepos,
  t: Target,
  row: EngineRunRow,
  by: string,
) {
  if (!row.pendingLinks?.length) return;
  if (!r.links) throw new PackToolBusinessError("contracts tool: product links unavailable");
  const out = await r.links.link(t.id, row.pendingLinks as Links, by);
  if (out.kind !== "ok")
    throw new PackToolBusinessError(`contracts tool: product-links ${out.kind}`);
}

/** Trong tx khoá HĐ: thuộc run → (đã ghi ⇒ xong) → đủ bước bắt buộc → ghi "Đã duyệt" → gắn SP. */
async function finalizeInTx(
  r: ApprovalEngineTxRepos,
  t: Target,
  o: { passed: readonly string[]; by: string | null; depts: readonly string[] | null },
): Promise<void> {
  const row = await r.approvalEngine.byRun(t.run, { lock: true });
  if (!inRun(row, t.id)) throw new PackToolBusinessError("contracts tool: contract not in run");
  if (row.approvalStatus === "done") return; // đã ghi ở lần gọi trước (tool chạy lại)
  // CR-121 D-1 · `requiredSteps` theo CÙNG dữ kiện với lần rẽ (giá trị dưới khoá HĐ + đối tác mới cùng tx + phòng ban).
  const facts = fullFacts(row, o.depts, await partnerIn(r, t.id, row.flowSteps));
  if (!o.by || !finalizeReady(engineSteps(row.flowSteps), facts, o.passed))
    throw new PackToolBusinessError("contracts tool: required steps not passed");
  if (!(await r.approvalEngine.finalize(t.id, row.approvalId, t.run, o.by)))
    throw new PackToolBusinessError("contracts tool: approval not open");
  await applyPendingLinks(r, t, row, o.by);
}

/** Tool `contracts-finalize`: kiểm lại dưới khoá HĐ, ghi "Đã duyệt" + gắn SP chờ trong CÙNG tx. Gọi lại sau khi đã ghi ⇒ ok.
 *  esign-flow · SAU commit: bước Ký số (nếu mẫu chụp có) tự gửi ký — idempotent (claim trên lượt), lỗi chỉ log, không làm hỏng tool. */
export type FinalizeDeps = Pick<ApprovalEngineDeps, "uow" | "bridge" | "afterApproved"> &
  Partial<Pick<ApprovalEngineDeps, "warn">> &
  FactsDeps;
export function finalizeRun(d: FinalizeDeps) {
  return async (ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) => {
    const t = target(ctx, args);
    const port = d.bridge.port;
    if (!port) throw new PackToolBusinessError("contracts tool: engine off");
    // CR-121 D-1 · phòng ban đọc SONG SONG với stage đã Đạt (mẫu chưa đọc ⇒ đọc khi nguồn có; không thêm độ trễ), ngoài tx khoá HĐ.
    const [passed, by, depts] = await Promise.all([
      port.passedStages(t.who.tenantId, t.run),
      port.lastApprover(t.who.tenantId, t.run),
      departmentsOf(d, t.who, true),
    ]);
    await d.uow.tenant(t.who, (r) => finalizeInTx(r, t, { passed, by, depts }));
    if (d.afterApproved)
      await d
        .afterApproved(t.who.tenantId, t.id)
        .catch((e: unknown) =>
          d.warn?.("contract-esign-flow-failed", { contract_id: t.id, ...engineErrMeta(e) }),
        );
    return {};
  };
}
