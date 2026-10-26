// contract-flow S3a · duyệt HĐ chạy trên engine quy trình (bật bằng `CONTRACTS_APPROVAL_ENGINE=on` + engine gắn cầu). Lớp 2: chỉ cổng.
// - `startEngineApproval`: chỗ mở duyệt cấp 1 (sau AI đọc / nhập tay) ⇒ đồng bộ def theo version mẫu (`ensureDef`) → mở run có
//   `ref {pack:'contracts', record_id}` (COMMIT, chưa kick) → tx gói gắn run vào lượt (`mode='engine'`, `engine_run_id`,
//   `flow_version`, `flow_steps`) → kick; gắn hụt ⇒ huỷ bù. Lỗi bất kỳ trước khi gắn ⇒ lượt giữ chế độ máy (hành vi cũ).
// - `routeStep` (tool `contracts-route`) / `finalizeRun` (tool `contracts-finalize`): chạy trong tx gói của tenant run, CHỈ chạm HĐ có
//   `engine_run_id = ctx.processRunId`. Finalize kiểm lại stage đã Đạt phủ đủ bước bắt buộc theo giá trị HIỆN TẠI (khoá HĐ) + mẫu
//   chụp, ghi "Đã duyệt" (`confirmed_by` = người Đạt gần nhất) rồi áp `pending_links` CÙNG tx — lỗi gắn SP ⇒ ROLLBACK, không khoá.
import type { PackWho } from "../../kit/application/ports";
import {
  engineDefVersion,
  engineStartable,
  factsOf,
  finalizeReady,
  routeFrom,
} from "../domain/approval-engine.rules";
import {
  APPROVAL_PROCESS_KEY,
  compileDef,
  defaultFlowFromSettings,
  type FlowStep,
  flowGroupIds,
  routeNext,
} from "../domain/approval-flow.rules";
import type {
  ApprovalEngineBridge,
  ApprovalEnginePort,
  ApprovalEngineTxRepos,
  ApprovalEngineUow,
  EngineCaller,
  EngineRunRow,
} from "./approval-engine.ports";
import type { FlowDefSync, FlowGroups } from "./approval-flow.usecase";
import type { ProductLinksRepo } from "./product-links.usecase";

export type ApprovalEngineDeps = {
  bridge: ApprovalEngineBridge;
  uow: ApprovalEngineUow;
  groups: FlowGroups;
  warn: (msg: string, meta: Record<string, unknown>) => void;
};
/** Danh tính lời gọi tool (cấu trúc khớp `PackToolCtx`). */
export type EngineToolCtx = { tenantId: string; userId: string; processRunId?: string | null };
export type EngineStartOutcome = "started" | "machine" | "skipped";

/** Mẫu mặc định (chưa lưu) = version 1 (S2). */
const DEFAULT_FLOW_VERSION = 1;
/** Cổng engine dùng ở đây (ensureDef/start/cancel) không xét vai trò; người gọi = người mở duyệt. */
const callerOf = (who: PackWho): EngineCaller => ({ ...who, role: "member" });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `defVersion` = version def engine (`pack_version`; S3b: đổi cài đặt khi chưa lưu mẫu ⇒ tăng ⇒ ensureDef ghi đè). */
type Flow = { version: number; steps: readonly FlowStep[]; defVersion: number };

/** Def theo mẫu; Group mẫu trỏ không còn ở tenant / mẫu rỗng ⇒ null (giữ chế độ máy). */
async function compiled(
  d: ApprovalEngineDeps,
  tenantId: string,
  f: { steps: readonly FlowStep[] },
) {
  const have = await d.groups.existingIds(tenantId, flowGroupIds(f.steps));
  try {
    return compileDef(f, new Set(have)) as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Mẫu hiện hành của tenant + trạng thái lượt của HĐ (một tx); mặc định ⇒ Group theo khoá đọc sau tx (cache). */
async function loadStart(d: ApprovalEngineDeps, who: PackWho, id: string) {
  const got = await d.uow.tenant(who, async (r) => {
    const st = await r.approvalEngine.startState(id);
    if (!st || !engineStartable(st)) return null;
    return readFlow(r);
  });
  if (!got) return null;
  return flowOf(d, who, got);
}

type FlowRead = Awaited<ReturnType<typeof readFlow>>;
/** Mẫu đã lưu, hoặc (chưa lưu) cài đặt + `rev` (lần lưu cài đặt gần nhất) để dựng mẫu mặc định. */
async function readFlow(r: ApprovalEngineTxRepos) {
  const f = await r.approvalFlow.flow();
  if (f) return { f, s: null, rev: 0 };
  return { f: null, s: await r.approvalFlow.settings(), rev: await r.approvalFlow.settingsRev() };
}

async function flowOf(d: ApprovalEngineDeps, who: PackWho, got: FlowRead): Promise<Flow> {
  if (got.f) {
    const defVersion = engineDefVersion({ version: got.f.version, isDefault: false }, 0);
    return { version: got.f.version, steps: got.f.steps, defVersion };
  }
  const s = got.s as NonNullable<typeof got.s>;
  const ids = await d.groups.idsOf(who.tenantId, [s.level1GroupKey, s.level2GroupKey]);
  const defVersion = engineDefVersion({ version: DEFAULT_FLOW_VERSION, isDefault: true }, got.rev);
  return { version: DEFAULT_FLOW_VERSION, steps: defaultFlowFromSettings(s, ids), defVersion };
}

/** Mở run (COMMIT, chưa kick) → gắn vào lượt dưới RLS → kick; gắn hụt (đua / lượt đã đổi) ⇒ huỷ bù. */
async function openRun(
  d: ApprovalEngineDeps,
  port: ApprovalEnginePort,
  who: PackWho,
  c: { id: string; flow: Flow },
): Promise<EngineStartOutcome> {
  const u = callerOf(who);
  const req = {
    process_key: APPROVAL_PROCESS_KEY,
    input: c.id,
    inputs: [{ type: "text" as const, key: "contract-id", text: c.id }],
    ref: { pack: "contracts", record_id: c.id },
  };
  const { runId, kick } = await port.start(u, req);
  let attached = false;
  try {
    attached = await d.uow.tenant(who, async (r) => {
      const st = await r.approvalEngine.startState(c.id);
      if (!st?.approvalId || !engineStartable(st)) return false;
      const a = { runId, version: c.flow.version, steps: c.flow.steps };
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
      const flow = await loadStart(d, who, id);
      if (!flow) return "skipped";
      const def = await compiled(d, who.tenantId, flow);
      if (!def) {
        d.warn("contract-engine-flow-invalid", { contract_id: id });
        return "machine";
      }
      await port.ensureDef(callerOf(who), APPROVAL_PROCESS_KEY, def, flow.defVersion);
      return await openRun(d, port, who, { id, flow });
    } catch (e) {
      d.warn("contract-engine-start-failed", {
        contract_id: id,
        error: e instanceof Error ? e.name : "unknown",
      });
      return "machine";
    }
  };
}

/** S2 seam `FlowDefSync`: lưu mẫu ⇒ đẩy def version mới (lỗi chỉ log — lần mở duyệt kế đồng bộ lại). */
export function engineFlowDefSync(d: ApprovalEngineDeps): FlowDefSync {
  return {
    async sync(who, flow) {
      const port = d.bridge.port;
      if (!port) return;
      try {
        const def = await compiled(d, who.tenantId, flow);
        const v = engineDefVersion({ version: flow.version, isDefault: false }, 0);
        if (def) await port.ensureDef(callerOf(who), APPROVAL_PROCESS_KEY, def, v);
      } catch (e) {
        d.warn("contract-engine-def-sync-failed", {
          error: e instanceof Error ? e.name : "unknown",
        });
      }
    },
  };
}

/** S3b · cài đặt duyệt (ngưỡng/Group) đổi: tenant CHƯA lưu mẫu ⇒ đồng bộ lại def mặc định (version mới theo lần lưu cài đặt).
 *  Đã lưu mẫu ⇒ không làm gì (mẫu quyết). Không ném: lỗi chỉ log — lần mở duyệt kế đồng bộ lại. */
export function engineSettingsSync(d: ApprovalEngineDeps) {
  return async (who: PackWho): Promise<void> => {
    const port = d.bridge.port;
    if (!port) return;
    try {
      const got = await d.uow.tenant(who, (r) => readFlow(r));
      if (got.f) return;
      const flow = await flowOf(d, who, got);
      const def = await compiled(d, who.tenantId, flow);
      if (def) await port.ensureDef(callerOf(who), APPROVAL_PROCESS_KEY, def, flow.defVersion);
    } catch (e) {
      d.warn("contract-engine-settings-sync-failed", {
        error: e instanceof Error ? e.name : "unknown",
      });
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
    const from = routeFrom(args.from_step, row.flowSteps.length);
    if (from === null) throw new Error("contracts tool: bad from_step");
    return { next: routeNext(row.flowSteps, factsOf(row.deal, row.totalValue), from) };
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
  if (!o.by || !finalizeReady(row.flowSteps, facts, o.passed))
    throw new Error("contracts tool: required steps not passed");
  if (!(await r.approvalEngine.finalize(t.id, row.approvalId, t.run, o.by)))
    throw new Error("contracts tool: approval not open");
  await applyPendingLinks(r, t, row, o.by);
}

/** Tool `contracts-finalize`: kiểm lại dưới khoá HĐ, ghi "Đã duyệt" + gắn SP chờ trong CÙNG tx. Gọi lại sau khi đã ghi ⇒ ok. */
export function finalizeRun(d: Pick<ApprovalEngineDeps, "uow" | "bridge">) {
  return async (ctx: EngineToolCtx, args: Readonly<Record<string, unknown>>) => {
    const t = target(ctx, args);
    const port = d.bridge.port;
    if (!port) throw new Error("contracts tool: engine off");
    const [passed, by] = await Promise.all([
      port.passedStages(t.who.tenantId, t.run),
      port.lastApprover(t.who.tenantId, t.run),
    ]);
    await d.uow.tenant(t.who, (r) => finalizeInTx(r, t, { passed, by }));
    return {};
  };
}
