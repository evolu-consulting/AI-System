// HD-FR-32 · AC34f · D3-03 · review M2(c) S1: tool gói hợp đồng — gọi không thuộc run (`/mcp` ⇒ `processRunId` null) ⇒ ném,
// 0 truy cập repo; `contracts-finalize` đọc lại giá trị + ngưỡng: cần cấp 2 mà run chưa Đạt ở `approve` ⇒ ném, 0 ghi.
import { describe, expect, test } from "bun:test";
import type { PackRunsPort } from "../../kit/application/pack-runs.ports";
import type { PackToolCtx, PackToolDef } from "../../kit/application/pack-tools.ports";
import type { ApprovalRepo, ApprovalUow } from "../application/approval.ports";
import { APPROVAL_DEFAULTS, CONTRACT_TOOL_KEYS } from "../domain/approval-def.rules";
import { contractsTools } from "./contracts.tools";

const RUN = "11111111-1111-4111-8111-111111111111";
const CID = "22222222-2222-4222-8222-222222222222";

function harness(o: { value: number | null; passed: string[]; finalizeOk?: boolean }) {
  const calls: string[] = [];
  const repo = {
    beginExtract: async () => {
      calls.push("begin");
      return "skip";
    },
    valueOf: async () => {
      calls.push("value");
      return o.value;
    },
    settings: async () => {
      calls.push("settings");
      return { ...APPROVAL_DEFAULTS };
    },
    // Luật cấp 2 nằm trong câu UPDATE (repo): fake ghi lại cờ `level2Passed` mà tool truyền xuống.
    finalize: async (_i: string, _r: string, _b: string | null, level2Passed: boolean) => {
      calls.push(`finalize:${level2Passed}`);
      return o.finalizeOk ?? true;
    },
  } as unknown as ApprovalRepo;
  const uow = {
    tenant: (_w: unknown, fn: (r: unknown) => unknown) => fn({ approval: repo }),
  } as unknown as ApprovalUow;
  const port = {
    lastApprover: async () => "u-approver",
    passedStages: async () => o.passed,
  } as unknown as PackRunsPort;
  const tools = contractsTools({
    bridge: { port },
    uow,
    agentKey: "x",
    runExtraction: () => async () => "skipped",
    makeAgent: () => ({ extract: async () => ({ ok: false, code: "AGENT_UNAVAILABLE" }) }),
  });
  const tool = (k: string) => tools.find((t) => t.name === k) as PackToolDef;
  return { calls, tool };
}
const ctx = (processRunId: string | null): PackToolCtx => ({
  tenantId: "t",
  userId: "u",
  runId: "hub-run",
  processRunId,
});

describe("contracts tools [D3-03]", () => {
  test("AC34f · processRunId null (/mcp) ⇒ mọi tool ném, 0 truy cập repo", async () => {
    const h = harness({ value: 1, passed: [] });
    for (const k of Object.values(CONTRACT_TOOL_KEYS))
      await expect(h.tool(k).run(ctx(null), { contract_id: CID })).rejects.toThrow();
    expect(h.calls).toEqual([]);
  });
  test("S1 · finalize truyền `level2Passed` = đã Đạt/use_current ở `approve`; repo từ chối (cần cấp 2) ⇒ ném", async () => {
    const h = harness({ value: 600_000_000, passed: ["extract"], finalizeOk: false });
    await expect(
      h.tool(CONTRACT_TOOL_KEYS.finalize).run(ctx(RUN), { contract_id: CID }),
    ).rejects.toThrow();
    expect(h.calls).toEqual(["finalize:false"]);
  });
  test("S1 · đã qua `approve` ⇒ finalize(level2Passed=true) ghi", async () => {
    const a = harness({ value: 600_000_000, passed: ["extract", "approve"] });
    await a.tool(CONTRACT_TOOL_KEYS.finalize).run(ctx(RUN), { contract_id: CID });
    expect(a.calls).toEqual(["finalize:true"]);
  });
});
