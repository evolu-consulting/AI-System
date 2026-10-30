// contract-flow S3a · duyệt HĐ chạy trên engine quy trình (bật bằng `CONTRACTS_APPROVAL_ENGINE=on` + engine gắn cầu). Lớp 2: chỉ cổng.
// - `startEngineApproval`: chỗ mở duyệt cấp 1 (sau AI đọc / nhập tay) ⇒ đồng bộ def theo version mẫu (`ensureDef`) → mở run có
//   `ref {pack:'contracts', record_id}` (COMMIT, chưa kick) → tx gói gắn run vào lượt (`mode='engine'`, `engine_run_id`,
//   `flow_version`, `flow_steps`) → kick; gắn hụt ⇒ huỷ bù. Lỗi bất kỳ trước khi gắn ⇒ lượt giữ chế độ máy (hành vi cũ).
// - `routeStep` (tool `contracts-route`) / `finalizeRun` (tool `contracts-finalize`): chạy trong tx gói của tenant run, CHỈ chạm HĐ có
//   `engine_run_id = ctx.processRunId`. Finalize kiểm lại stage đã Đạt phủ đủ bước bắt buộc theo giá trị HIỆN TẠI (khoá HĐ) + mẫu
//   chụp, ghi "Đã duyệt" (`confirmed_by` = người Đạt gần nhất) rồi áp `pending_links` CÙNG tx — lỗi gắn SP ⇒ ROLLBACK, không khoá.
import type { PackWho } from "../../kit/application/ports";
import { PACK_OWNER_GROUP_KEY } from "../domain/approval-def.rules";
import {
  engineStartable,
  factsOf,
  finalizeReady,
  reconcileOf,
  routeFrom,
} from "../domain/approval-engine.rules";
import {
  APPROVAL_PROCESS_KEY,
  compileDef,
  difyRunInputs,
  difySelectBindings,
  engineSteps,
  type FlowStep,
  flowGroupIds,
  hasDifyStep,
  routeNext,
} from "../domain/approval-flow.rules";
import type {
  ApprovalEngineBridge,
  ApprovalEnginePort,
  ApprovalEngineTxRepos,
  ApprovalEngineUow,
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
  groups: FlowGroups;
  warn: (msg: string, meta: Record<string, unknown>) => void;
  /** esign-flow · sau khi ghi "Đã duyệt" (đã COMMIT): chạy bước Ký số của mẫu chụp. Vắng ⇒ không có bước ký tự động. */
  afterApproved?: ((tenantId: string, contractId: string) => Promise<unknown>) | undefined;
};
/** Danh tính lời gọi tool (cấu trúc khớp `PackToolCtx`). */
export type EngineToolCtx = { tenantId: string; userId: string; processRunId?: string | null };
export type EngineStartOutcome = "started" | "machine" | "skipped";

/** Cổng engine dùng ở đây (ensureDef/start/cancel) không xét vai trò; người gọi = người mở duyệt. */
const callerOf = (who: PackWho): EngineCaller => ({ ...who, role: "member" });
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
type Flow = EngineFlow;

/** prod-fix2 · Group "Toàn quyền" của gói còn ở tenant: Group cấp 2 của cài đặt + Group vai owner (quyền gói `admin`). */
async function ownerGroupIds(d: ApprovalEngineDeps, who: PackWho): Promise<string[]> {
  const s = await d.uow.tenant(who, (r) => r.approvalFlow.settings());
  const ids = await d.groups.idsOf(who.tenantId, [s.level2GroupKey, PACK_OWNER_GROUP_KEY]);
  return [...new Set(ids.values())];
}

/** Def theo mẫu; Group mẫu trỏ không còn ở tenant / mẫu rỗng ⇒ null (giữ chế độ máy). */
async function compiled(
  d: ApprovalEngineDeps,
  who: PackWho,
  f: { steps: readonly FlowStep[] } | null,
) {
  if (!f) return null; // CR-105 · khe thiếu mã Group ở tenant ⇒ máy cũ
  const tenantId = who.tenantId;
  const [have, owners] = await Promise.all([
    d.groups.existingIds(tenantId, flowGroupIds(f.steps)),
    ownerGroupIds(d, who),
  ]);
  // cf-dify · bước Dify: tham số workflow lấy từ catalog hiện hành của tenant (workflow đã gỡ ⇒ compile ném ⇒ null).
  const catalog = hasDifyStep(f.steps) ? ((await d.bridge.port?.workflowsOf(tenantId)) ?? []) : [];
  try {
    return compileDef(
      f,
      new Set([...have, ...owners]),
      new Map(catalog.map((w) => [w.key, w])),
      owners,
    ) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Mẫu hiện hành của tenant + trạng thái lượt của HĐ (một tx); mặc định ⇒ Group theo khoá đọc sau tx (cache). `ok` quyết lượt có
 *  mở/mở lại được không. Trả thêm NGƯỜI BẮT ĐẦU của lượt: run luôn mở dưới người này (không phải người kích job / bấm Đọc lại). */
async function loadStart(
  d: ApprovalEngineDeps,
  who: PackWho,
  id: string,
  ok: (st: EngineStartRow) => boolean = engineStartable,
) {
  // CR-105 · tra khe theo tenant mỗi lần mở lượt (gán ⇒ mặc định ⇒ bản xuất bản).
  const slot = await slotFlowOf(d, who.tenantId);
  const st = await d.uow.tenant(who, async (r) => {
    const s = await r.approvalEngine.startState(id);
    return s?.startedBy && ok(s) ? s : null;
  });
  if (!st) return null;
  // Khe không có bản áp được / body hỏng / thiếu mã Group ⇒ flow null ⇒ lượt chạy máy 2 bước cũ (không còn đường `readFlow`).
  const flow: Flow | null = slot === "invalid" ? null : slot;
  return { flow, starter: st.startedBy as string, st };
}

/** Mở run (COMMIT, chưa kick) → gắn vào lượt dưới RLS → kick; gắn hụt (đua / lượt đã đổi) ⇒ huỷ bù. */
async function openRun(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  c: OpenRunArgs,
): Promise<EngineStartOutcome> {
  // started_by của run = người bắt đầu lượt duyệt (exclude_starter phải còn nghĩa sau Đọc lại / heal do người khác kích).
  const u = callerOf({ tenantId: who.tenantId, userId: c.starter });
  const facts = hasDifyStep(c.flow.steps)
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
    ],
    ref: { pack: "contracts", record_id: c.id },
    ...slotRunOf(c.flow, c.def, port),
  };
  const { runId, kick } = await port.start(u, req);
  let attached = false;
  try {
    attached = await d.uow.tenant(who, async (r) => {
      const st = await r.approvalEngine.startState(c.id);
      const ok = c.replaces ? stalledRef(st, c.replaces) : !!st && engineStartable(st);
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

/** Gọi SAU khi lượt duyệt vào `level1` (đã COMMIT). Không ném: lỗi ⇒ log, lượt chạy máy cũ. */
export function startEngineApproval(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<EngineStartOutcome> => {
    const port = d.bridge.port;
    if (!port) return "machine";
    try {
      const got = await loadStart(d, who, id);
      if (!got) return "skipped";
      const { flow, starter } = got;
      const def = await compiled(d, who, flow);
      if (!def || !flow) {
        d.warn("contract-engine-flow-invalid", { contract_id: id });
        return "machine";
      }
      await port.ensureDef(callerOf(who), APPROVAL_PROCESS_KEY, def, defVersionOf(flow, def, port));
      return await openRun(d, port, who, { id, flow, starter, def });
    } catch (e) {
      d.warn("contract-engine-start-failed", { contract_id: id, ...engineErrMeta(e) });
      return "machine";
    }
  };
}

/** Lượt đang giữ đúng run `run` ở chế độ engine, còn `level1` (điều kiện mở lại). */
const stalledRef = (st: EngineStartRow | null, run: string): boolean =>
  st?.approvalStatus === "level1" && st.mode === "engine" && st.engineRunId === run;

export type ReopenOutcome = "ok" | "not_found" | "not_stalled" | "failed";

/** fix-review · Mở lại quy trình cho lượt engine mà run đã kết thúc bất thường (huỷ ngoài luồng / lỗi / mất): chỉ gọi ở route
 *  owner/admin của gói. KHÔNG trả lượt về máy cũ; run mới mở dưới người bắt đầu lượt (`started_by`) với mẫu HIỆN HÀNH. Kiểm run thật sự
 *  kết thúc bất thường bằng `outcomesOf` (không tin cờ từ client). Không vòng lặp tự động: mỗi lần là một thao tác của owner. */
type Stalled = { got: NonNullable<Awaited<ReturnType<typeof loadStart>>>; run: string };
/** Lượt engine có run đã kết thúc bất thường? (kiểm bằng `outcomesOf` — không tin cờ từ client). */
async function findStalled(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  id: string,
): Promise<Stalled | "not_found" | "not_stalled"> {
  const got = await loadStart(
    d,
    who,
    id,
    (s) => s.mode === "engine" && s.approvalStatus === "level1",
  );
  if (!got) return "not_found";
  const run = got.st.engineRunId;
  if (!run) return "not_stalled";
  const [o] = await port.outcomesOf(who.tenantId, [run]);
  return reconcileOf(o).kind === "stalled" ? { got, run } : "not_stalled";
}

export function reopenEngineApproval(d: ApprovalEngineDeps) {
  return async (who: PackWho, id: string): Promise<ReopenOutcome> => {
    const port = d.bridge.port;
    if (!port) return "failed";
    try {
      const s = await findStalled(d, port, who, id);
      if (typeof s === "string") return s;
      const flow = s.got.flow;
      const def = await compiled(d, who, flow);
      if (!def || !flow) return "failed";
      const caller = callerOf({ tenantId: who.tenantId, userId: s.got.starter });
      await port.ensureDef(caller, APPROVAL_PROCESS_KEY, def, defVersionOf(flow, def, port));
      const out = await openRun(d, port, who, { id, ...s.got, flow, def, replaces: s.run });
      return out === "started" ? "ok" : "not_stalled";
    } catch (e) {
      d.warn("contract-engine-reopen-failed", { contract_id: id, ...engineErrMeta(e) });
      return "failed";
    }
  };
}
/** Lời gọi phải thuộc một run (stage tool) và chỉ HĐ hợp lệ; sai ⇒ ném (`tool_failed`). `/mcp` (không run) ⇒ từ chối. */
function target(ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) {
  const id = String(args.contract_id ?? "");
  const run = ctx.processRunId ?? null;
  if (!run || !UUID.test(run) || !UUID.test(id))
    throw new Error("contracts tool: not a run of this contract");
  return { id, run, who: { tenantId: ctx.tenantId, userId: ctx.userId } };
}
const inRun = (row: EngineRunRow | null, id: string): row is EngineRunRow =>
  row !== null && row.contractId === id;

/** Tool `contracts-route`: `next` = bước engine kế theo mẫu chụp + giá trị HIỆN TẠI của HĐ. */
export function routeStep(d: Pick<ApprovalEngineDeps, "uow">) {
  return async (ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) => {
    const t = target(ctx, args);
    const row = await d.uow.tenant(t.who, (r) => r.approvalEngine.byRun(t.run, { lock: false }));
    if (!inRun(row, t.id) || row.approvalStatus !== "level1")
      throw new Error("contracts tool: contract not in run");
    const steps = engineSteps(row.flowSteps); // esign-flow · bước Ký số không là stage engine
    const from = routeFrom(args.from_step, steps.length);
    if (from === null) throw new Error("contracts tool: bad from_step");
    return { next: routeNext(steps, factsOf(row.deal, row.totalValue), from) };
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
  if (!r.links) throw new Error("contracts tool: product links unavailable");
  const out = await r.links.link(t.id, row.pendingLinks as Links, by);
  if (out.kind !== "ok") throw new Error(`contracts tool: product-links ${out.kind}`);
}

/** Trong tx khoá HĐ: thuộc run → (đã ghi ⇒ xong) → đủ bước bắt buộc → ghi "Đã duyệt" → gắn SP. */
async function finalizeInTx(
  r: ApprovalEngineTxRepos,
  t: Target,
  o: { passed: readonly string[]; by: string | null },
): Promise<void> {
  const row = await r.approvalEngine.byRun(t.run, { lock: true });
  if (!inRun(row, t.id)) throw new Error("contracts tool: contract not in run");
  if (row.approvalStatus === "done") return; // đã ghi ở lần gọi trước (tool chạy lại)
  const facts = factsOf(row.deal, row.totalValue);
  if (!o.by || !finalizeReady(engineSteps(row.flowSteps), facts, o.passed))
    throw new Error("contracts tool: required steps not passed");
  if (!(await r.approvalEngine.finalize(t.id, row.approvalId, t.run, o.by)))
    throw new Error("contracts tool: approval not open");
  await applyPendingLinks(r, t, row, o.by);
}

/** Tool `contracts-finalize`: kiểm lại dưới khoá HĐ, ghi "Đã duyệt" + gắn SP chờ trong CÙNG tx. Gọi lại sau khi đã ghi ⇒ ok.
 *  esign-flow · SAU commit: bước Ký số (nếu mẫu chụp có) tự gửi ký — idempotent (claim trên lượt), lỗi chỉ log, không làm hỏng tool. */
export type FinalizeDeps = Pick<ApprovalEngineDeps, "uow" | "bridge" | "afterApproved"> &
  Partial<Pick<ApprovalEngineDeps, "warn">>;
export function finalizeRun(d: FinalizeDeps) {
  return async (ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) => {
    const t = target(ctx, args);
    const port = d.bridge.port;
    if (!port) throw new Error("contracts tool: engine off");
    const [passed, by] = await Promise.all([
      port.passedStages(t.who.tenantId, t.run),
      port.lastApprover(t.who.tenantId, t.run),
    ]);
    await d.uow.tenant(t.who, (r) => finalizeInTx(r, t, { passed, by }));
    if (d.afterApproved)
      await d
        .afterApproved(t.who.tenantId, t.id)
        .catch((e: unknown) =>
          d.warn?.("contract-esign-flow-failed", { contract_id: t.id, ...engineErrMeta(e) }),
        );
    return {};
  };
}
