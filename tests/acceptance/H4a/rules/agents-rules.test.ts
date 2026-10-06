// HUB-FR-64 · HUB-FR-61 · HUB-FR-60 · H4a-R04, R05, R06 · QB3, QB7 · plan §4.1 · test-plan H4a §3 R01–R24: luật thuần
// agent Studio — `workflowProblem` (thứ tự not_found → disabled → app_type → no_input), `needsBashAck` (chỉ khi THÊM Bash),
// `deleteBlocker` (Orchestrator → lịch sử → quyền), `disableBlocked`, `difyOptions`, `agentWarnings`.
import { describe, expect, it } from "bun:test";
import {
  agentWarnings,
  deleteBlocker,
  difyOptions,
  disableBlocked,
  needsBashAck,
  workflowProblem,
} from "../../../../apps/hub-api/src/modules/studio/agents/agents.rules";

const id = (n: number) => `e4a00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
type Wf = { id: string; key: string; enabled: boolean; appType: string; hasDifyInput: boolean };
const wf = (n: number, o: Partial<Wf> = {}): Wf => ({
  id: id(n),
  key: `wf-${n}`,
  enabled: true,
  appType: "workflow",
  hasDifyInput: true,
  ...o,
});
const W = {
  ok: wf(1),
  off: wf(2, { enabled: false }),
  chat: wf(3, { appType: "chat" }),
  agent: wf(4, { appType: "agent" }),
  noInput: wf(5, { hasDifyInput: false }),
  chatNoInput: wf(6, { appType: "chat", hasDifyInput: false }),
} as const;
const ALL = Object.values(W);
const MISSING = id(99);

describe("workflowProblem [HUB-FR-64 · H4a-R04 · H4a-AC-05 · QB3]", () => {
  it("HUB-FR-64 · R01 · id không có trong catalog ⇒ {reason: not_found, ids: [id thiếu]} (che mọi lỗi khác) [H4a-AC-05]", () => {
    expect(workflowProblem("dify-workflow", ALL, [MISSING])).toMatchObject({
      reason: "not_found",
      ids: [MISSING],
    });
    expect(workflowProblem("llm", ALL, [W.off.id, MISSING])).toMatchObject({
      reason: "not_found",
      ids: [MISSING],
    });
  });

  it("HUB-FR-64 · R02 · workflow tắt ⇒ disabled (trước app_type) [H4a-AC-05 · H4a-R04]", () => {
    expect(workflowProblem("llm", ALL, [W.ok.id, W.off.id])).toMatchObject({ reason: "disabled" });
    expect(workflowProblem("dify-agent", [wf(7, { enabled: false })], [id(7)])).toMatchObject({
      reason: "disabled",
    });
  });

  it("HUB-FR-64 · R03 · dify-workflow + app chat/agent ⇒ app_type; dify-agent + app workflow ⇒ app_type [H4a-R04 · QB3]", () => {
    expect(workflowProblem("dify-workflow", ALL, [W.chat.id])).toMatchObject({
      reason: "app_type",
    });
    expect(workflowProblem("dify-workflow", ALL, [W.agent.id])).toMatchObject({
      reason: "app_type",
    });
    expect(workflowProblem("dify-agent", ALL, [W.ok.id])).toMatchObject({ reason: "app_type" });
  });

  it("HUB-FR-64 · R04 · dify-* không có input Dify ⇒ no_input (sau app_type) [H4a-R04]", () => {
    expect(workflowProblem("dify-workflow", ALL, [W.noInput.id])).toMatchObject({
      reason: "no_input",
    });
    expect(workflowProblem("dify-agent", ALL, [W.chatNoInput.id])).toMatchObject({
      reason: "no_input",
    });
  });

  it("HUB-FR-64 · R05 · hợp lệ ⇒ null: dify-workflow + workflow; dify-agent + chat | agent (QB3); llm/agentic-cli/python 0..n, bỏ qua app/input [H4a-R04]", () => {
    expect(workflowProblem("dify-workflow", ALL, [W.ok.id])).toBeNull();
    expect(workflowProblem("dify-agent", ALL, [W.chat.id])).toBeNull();
    expect(workflowProblem("dify-agent", ALL, [W.agent.id])).toBeNull();
    for (const rt of ["llm", "agentic-cli", "python"] as const) {
      expect([rt, workflowProblem(rt, ALL, [])]).toEqual([rt, null]);
      expect([rt, workflowProblem(rt, ALL, [W.chat.id, W.noInput.id, W.ok.id])]).toEqual([
        rt,
        null,
      ]);
    }
  });
});

describe("needsBashAck [HUB-FR-61 · H4a-R05 · H4a-AC-06]", () => {
  it("HUB-FR-61 · R06 · tạo mới (before null) có Bash ⇒ true; không Bash ⇒ false [H4a-AC-06]", () => {
    expect(needsBashAck(null, ["Read", "Bash"])).toBe(true);
    expect(needsBashAck(null, ["Read", "Grep"])).toBe(false);
    expect(needsBashAck(null, [])).toBe(false);
  });

  it("HUB-FR-61 · R07 · sửa: thêm Bash ⇒ true; đã có Bash giữ nguyên ⇒ false; bỏ Bash ⇒ false [H4a-R05]", () => {
    expect(needsBashAck(["Read"], ["Read", "Bash"])).toBe(true);
    expect(needsBashAck(["Bash"], ["Read", "Bash"])).toBe(false);
    expect(needsBashAck(["Read", "Bash"], ["Read"])).toBe(false);
  });

  it("HUB-FR-61 · R08 · phân biệt hoa thường: 'bash' không phải Bash [plan §2.2 STUDIO_CLI_TOOLS]", () => {
    expect(needsBashAck(null, ["bash"])).toBe(false);
  });
});

describe("deleteBlocker · disableBlocked [HUB-FR-60 · H4a-R06 · H4a-AC-07]", () => {
  const z = { orchestratorScopes: 0, hasHistory: false, activeEntitlements: 0, grants: 0 };
  it("HUB-FR-60 · R09 · không vướng ⇒ null [H4a-R06]", () => {
    expect(deleteBlocker(z)).toBeNull();
  });
  it("HUB-FR-60 · R10 · Orchestrator đi trước mọi chặn ⇒ AGENT_IN_USE_AS_ORCHESTRATOR [H4a-AC-07]", () => {
    expect(
      deleteBlocker({ orchestratorScopes: 1, hasHistory: true, activeEntitlements: 3, grants: 2 }),
    ).toBe("AGENT_IN_USE_AS_ORCHESTRATOR");
  });
  it("HUB-FR-60 · R11 · lịch sử trước quyền ⇒ AGENT_HAS_HISTORY [H4a-AC-07]", () => {
    expect(deleteBlocker({ ...z, hasHistory: true, activeEntitlements: 1, grants: 1 })).toBe(
      "AGENT_HAS_HISTORY",
    );
  });
  it("HUB-FR-60 · R12 · chỉ entitlement hoặc chỉ grant ⇒ AGENT_HAS_ACCESS [H4a-R06]", () => {
    expect(deleteBlocker({ ...z, activeEntitlements: 1 })).toBe("AGENT_HAS_ACCESS");
    expect(deleteBlocker({ ...z, grants: 1 })).toBe("AGENT_HAS_ACCESS");
  });
  it("HUB-FR-62 · R13 · disableBlocked: tắt khi đang là Orchestrator ⇒ true; bật hoặc không phải Orchestrator ⇒ false [H4a-R06]", () => {
    expect(disableBlocked(1, false)).toBe(true);
    expect(disableBlocked(2, false)).toBe(true);
    expect(disableBlocked(1, true)).toBe(false);
    expect(disableBlocked(0, false)).toBe(false);
  });
});

describe("difyOptions [HUB-FR-64 · QB3]", () => {
  it("HUB-FR-64 · R14 · dify-workflow/dify-agent ⇒ {workflow_key}; runtime khác ⇒ null [QB3 mặc định]", () => {
    expect(difyOptions("dify-workflow", { key: "tom" })).toEqual({ workflow_key: "tom" });
    expect(difyOptions("dify-agent", { key: "tro-ly" })).toEqual({ workflow_key: "tro-ly" });
    for (const rt of ["llm", "agentic-cli", "python"] as const)
      expect([rt, difyOptions(rt, { key: "tom" })]).toEqual([rt, null]);
  });
});

describe("agentWarnings [HUB-FR-60 · HUB-FR-61 · H4a-R05 · QB7]", () => {
  // Chữ ký `agentWarnings(a)` chưa ghi kiểu `a` (plan §4.1) — qc giả định `{runtime, runtime_options}` như AgentSchema.
  const cli = (o: Record<string, unknown> = {}) => ({
    runtime: "agentic-cli",
    runtime_options: {
      cli: "claude",
      allowed_tools: ["Read", "Grep"],
      mcp: false,
      cwd_mode: "job",
      ...o,
    },
  });
  const codes = (w: { code: string }[]) => w.map((x) => x.code).sort();

  it("HUB-FR-61 · R15 · agentic-cli claude, tool Runtime chạy được ⇒ [] [QB7]", () => {
    expect(agentWarnings(cli() as never)).toEqual([]);
  });
  it("HUB-FR-61 · R16 · cli codex | gemini ⇒ runtime_not_ready (Q8, CR-041) [H4a-R05]", () => {
    expect(codes(agentWarnings(cli({ cli: "codex" }) as never))).toEqual(["runtime_not_ready"]);
    expect(codes(agentWarnings(cli({ cli: "gemini" }) as never))).toEqual(["runtime_not_ready"]);
  });
  it("HUB-FR-61 · R17 · Edit/Bash ⇒ tools_not_supported với đúng tập tool ngoài ALLOWED_TOOLS [QB7]", () => {
    const w = agentWarnings(cli({ allowed_tools: ["Read", "Edit", "Bash", "Write"] }) as never);
    const t = w.find((x: { code: string }) => x.code === "tools_not_supported") as
      | { tools: string[] }
      | undefined;
    expect([...(t?.tools ?? [])].sort()).toEqual(["Bash", "Edit"]);
  });
  it("HUB-FR-60 · R18 · runtime llm, python ⇒ runtime_not_ready; dify-workflow ⇒ không cảnh báo runtime [QB7 · RUNNABLE_RUNTIMES]", () => {
    expect(codes(agentWarnings({ runtime: "llm", runtime_options: {} } as never))).toEqual([
      "runtime_not_ready",
    ]);
    expect(codes(agentWarnings({ runtime: "python", runtime_options: {} } as never))).toEqual([
      "runtime_not_ready",
    ]);
    expect(
      agentWarnings({
        runtime: "dify-workflow",
        runtime_options: { workflow_key: "tom" },
      } as never),
    ).toEqual([]);
  });
});
