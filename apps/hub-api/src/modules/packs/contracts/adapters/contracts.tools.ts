// HD-FR-32 · HD-FR-33 · HD-FR-37 · #219 · D3-01/D3-03/D3-04: tool gói của flow duyệt (stage `tool`, danh tính = người bắt đầu,
// tx gói của tenant run). Mọi tool CHỈ chạm HĐ có `run_id` = run gọi (`ctx.processRunId`; `/mcp` ⇒ null ⇒ từ chối). `extract`
// chạy lượt trích HD2 với agent KHÔNG tool qua `PackRuns.agent` (job gắn `hub.runs` của stage). Không log nội dung.
import type { PackRunsBridge } from "../../kit/application/pack-runs.ports";
import type { PackToolCtx, PackToolDef } from "../../kit/application/pack-tools.ports";
import type { ApprovalUow } from "../application/approval.ports";
import type { ExtractionAgent } from "../application/extraction.ports";
import type { RunExtraction } from "../application/run-extraction.usecase";
import { APPROVE_STAGE, CONTRACT_TOOL_KEYS, needsLevel2 } from "../domain/approval-def.rules";
import type { AgentTransport } from "./extraction-agent";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARAMS = [
  { name: "contract_id", type: "text", required: true, description: "Mã hợp đồng" },
] as const;

export type ContractsToolDeps = {
  bridge: PackRunsBridge;
  uow: ApprovalUow;
  /** Khoá agent trích (env `CONTRACTS_EXTRACT_AGENT`, mặc định `contracts-extractor`). */
  agentKey: string;
  /** Lượt trích HD2 dựng theo agent của lời gọi (agent gắn hub run của stage). */
  runExtraction: (agent: ExtractionAgent) => RunExtraction;
  makeAgent: (t: AgentTransport) => ExtractionAgent;
};

/** Ném (⇒ `tool_failed`) khi lời gọi không thuộc một run hoặc tham số sai. */
function target(ctx: PackToolCtx, args: Record<string, unknown>): { id: string; run: string } {
  const id = String(args.contract_id ?? "");
  const run = ctx.processRunId ?? null;
  if (!run || !UUID.test(id)) throw new Error("contracts tool: not a run of this contract");
  return { id, run };
}

/** #219 · transport = agent không tool trên `hub.runs` đang chạy của stage; PDF/ảnh không văn bản ⇒ chưa hỗ trợ (D3-04). */
function flowTransport(d: ContractsToolDeps, ctx: PackToolCtx): AgentTransport {
  return async (req) => {
    const port = d.bridge.port;
    if (!port || !ctx.runId || req.file) return { ok: false, code: "AGENT_UNAVAILABLE" };
    const ac = new AbortController();
    const stop = () => ac.abort();
    req.signal.addEventListener("abort", stop, { once: true });
    ctx.signal?.addEventListener("abort", stop, { once: true });
    try {
      const r = { hubRunId: ctx.runId, tenantId: req.who.tenantId, agentKey: d.agentKey };
      return await port.agent({ ...r, system: req.system, prompt: req.prompt, signal: ac.signal });
    } finally {
      req.signal.removeEventListener("abort", stop);
      ctx.signal?.removeEventListener("abort", stop);
    }
  };
}

async function valueFields(d: ContractsToolDeps, ctx: PackToolCtx, id: string, run: string) {
  const who = { tenantId: ctx.tenantId, userId: ctx.userId };
  const [v, s] = await d.uow.tenant(
    who,
    async (r) => [await r.approval.valueOf(id, run), await r.approval.settings()] as const,
  );
  if (v === undefined) throw new Error("contracts tool: contract not in run");
  return {
    ...(v === null ? {} : { total_value: v }),
    level2: needsLevel2(v, s.threshold) ? "yes" : "no",
  };
}

export function contractsTools(d: ContractsToolDeps): PackToolDef[] {
  const base = { pack: "contracts", params: PARAMS, side_effect: false, action: "write" as const };
  const extract: PackToolDef["run"] = async (ctx, args) => {
    const { id, run } = target(ctx, args);
    const who = { tenantId: ctx.tenantId, userId: ctx.userId };
    const begin = await d.uow.tenant(who, (r) => r.approval.beginExtract(id, run));
    if (begin === "denied") throw new Error("contracts tool: contract not in run");
    if (begin === "extract") await d.runExtraction(d.makeAgent(flowTransport(d, ctx)))(who, id);
    const { level2: _l2, ...rest } = await valueFields(d, ctx, id, run);
    return rest;
  };
  const value: PackToolDef["run"] = async (ctx, args) => {
    const { id, run } = target(ctx, args);
    return valueFields(d, ctx, id, run);
  };
  // Review S1 · đọc lại giá trị + ngưỡng HIỆN TẠI cùng tx với lệnh ghi: cần cấp 2 mà run chưa có Đạt ở stage `approve`
  // (def bị sửa bỏ cấp 2, giá trị đổi sau rẽ nhánh…) ⇒ ném (`tool_failed`), không ghi "Đã duyệt".
  const finalize: PackToolDef["run"] = async (ctx, args) => {
    const { id, run } = target(ctx, args);
    const port = d.bridge.port;
    if (!port) throw new Error("contracts tool: engine off");
    const [by, passed] = await Promise.all([
      port.lastApprover(ctx.tenantId, run),
      port.passedStages(ctx.tenantId, run),
    ]);
    const who = { tenantId: ctx.tenantId, userId: ctx.userId };
    const out = await d.uow.tenant(who, async (r) => {
      const v = await r.approval.valueOf(id, run);
      if (v === undefined) return "not_in_run";
      const s = await r.approval.settings();
      if (needsLevel2(v, s.threshold) && !passed.includes(APPROVE_STAGE)) return "level2_missing";
      return (await r.approval.finalize(id, run, by)) ? "ok" : "not_awaiting";
    });
    if (out !== "ok") throw new Error(`contracts tool: cannot finalize (${out})`);
    return {};
  };
  return [
    {
      ...base,
      name: CONTRACT_TOOL_KEYS.extract,
      description: "AI đọc hợp đồng (trích 23 trường).",
      run: extract,
    },
    {
      ...base,
      name: CONTRACT_TOOL_KEYS.value,
      description: "Giá trị hợp đồng so với ngưỡng duyệt cấp 2.",
      run: value,
    },
    {
      ...base,
      name: CONTRACT_TOOL_KEYS.finalize,
      description: "Ghi hợp đồng Đã duyệt.",
      run: finalize,
    },
  ];
}
