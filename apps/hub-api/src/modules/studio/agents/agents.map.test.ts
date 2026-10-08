// HUB-FR-60 · HUB-FR-69 · plan §2.3, §5.1 · hàm thuần map agent Studio.
import { describe, expect, it } from "bun:test";
import { auditSnapshot, changedFields, orchestratorOf, toAgent } from "./agents.map";
import type { AgentDbRow } from "./agents.repo";
import { runtimeOptionsOf } from "./agents.service";

const T1 = "b0000000-0000-4000-8000-000000000002";
const T2 = "b0000000-0000-4000-8000-000000000001";
const row: AgentDbRow = {
  id: "a0000000-0000-4000-8000-000000000001",
  key: "tom",
  name: { vi: "Tóm", en: "Sum" },
  description: "Tóm tắt văn bản dài cho người dùng",
  runtime: "dify-workflow",
  agentTypeKey: null,
  profileId: null,
  model: null,
  systemPrompt: "",
  runtimeOptions: { workflow_key: "tom" },
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
  createdAt: "2026-10-06T00:00:00.000Z",
  updatedAt: "2026-10-06T00:00:00.000Z",
};

describe("agents.map", () => {
  it("orchestratorOf: default + tenant_ids sắp xếp", () => {
    const s = [
      { tenantId: T1, tenantKey: "b" },
      { tenantId: null, tenantKey: null },
      { tenantId: T2, tenantKey: "a" },
    ];
    expect(orchestratorOf(s)).toEqual({ default: true, tenant_ids: [T2, T1] });
    expect(orchestratorOf([])).toEqual({ default: false, tenant_ids: [] });
  });

  it("changedFields: create ⇒ mọi khoá trừ meta; update ⇒ chỉ khoá khác", () => {
    expect(changedFields(null, { id: 1, version: 1, key: "a", name: {} })).toEqual(["key", "name"]);
    expect(changedFields({ a: 1, b: [1] }, { a: 1, b: [2], version: 2 })).toEqual(["b"]);
  });

  it("toAgent: workflow mất khỏi catalog chỉ còn trong workflow_ids; audit bỏ phần suy diễn", () => {
    const a = toAgent({ row, workflowIds: ["x"], workflows: [], scopes: [], similar: [] });
    expect(a).toMatchObject({ workflow_ids: ["x"], workflows: [], runnable: true, warnings: [] });
    expect(Object.keys(auditSnapshot(a))).not.toContain("warnings");
    expect(Object.keys(auditSnapshot(a))).not.toContain("orchestrator_of");
  });

  it("runtimeOptionsOf: dify-* lấy workflow_key từ workflow đã kiểm; runtime khác giữ nguyên", () => {
    const wf = {
      id: "w",
      key: "tom",
      name: "T",
      description: null,
      appType: "workflow",
      enabled: true,
      inputSchema: [],
    };
    expect(runtimeOptionsOf("dify-agent", undefined, [wf])).toEqual({ workflow_key: "tom" });
    expect(runtimeOptionsOf("llm", {}, [wf])).toEqual({});
    expect(runtimeOptionsOf("python", undefined, [])).toEqual({});
  });
});
