// HUB-FR-62 · HUB-FR-72 · HUB-FR-60 · H4a-R01, R07, R08 · QB1 · plan §4.2, §4.3, §2.2 (overlap.ts) · test-plan H4a §3
// R25–R40: `orchestratorAgentProblem` (not_found → disabled → runtime_unsupported; chỉ agentic-cli — QB1 mặc định),
// `orchestratorWarnings`, `tenantOrchestratorProblem` (not_found → inactive → exists), `isStudioRole`, Jaccard mô tả.
import { describe, expect, it } from "bun:test";
import {
  descriptionOverlap,
  descriptionTokens,
  formatAgentForOrchestrator,
  similarAgents,
} from "@ai/contracts/studio";
import { isStudioRole } from "../../../../apps/hub-api/src/lib/admin-role.middleware";
import {
  orchestratorAgentProblem,
  orchestratorWarnings,
  tenantOrchestratorProblem,
} from "../../../../apps/hub-api/src/modules/studio/orchestrator/orchestrator-settings.rules";

describe("orchestratorAgentProblem · orchestratorWarnings [HUB-FR-62 · H4a-R07, R08 · QB1]", () => {
  it("HUB-FR-62 · R25 · agent vắng ⇒ not_found (→ 400 INVALID_REFERENCE{agent_id}) [H4a-R07]", () => {
    expect(orchestratorAgentProblem(undefined)).toBe("not_found");
  });
  it("HUB-FR-62 · R26 · agent tắt (kể cả agentic-cli) ⇒ disabled, trước runtime [H4a-R07]", () => {
    expect(orchestratorAgentProblem({ enabled: false, runtime: "agentic-cli" })).toBe("disabled");
    expect(orchestratorAgentProblem({ enabled: false, runtime: "llm" })).toBe("disabled");
  });
  it("HUB-FR-62 · R27 · bật + runtime ≠ agentic-cli (llm, dify-*, python) ⇒ runtime_unsupported [QB1 mặc định · R-K1]", () => {
    for (const rt of ["llm", "dify-workflow", "dify-agent", "python"])
      expect([rt, orchestratorAgentProblem({ enabled: true, runtime: rt as never })]).toEqual([
        rt,
        "runtime_unsupported",
      ]);
  });
  it("HUB-FR-62 · R28 · bật + agentic-cli ⇒ null [H4a-R07 · QB1]", () => {
    expect(orchestratorAgentProblem({ enabled: true, runtime: "agentic-cli" })).toBeNull();
  });
  it("HUB-FR-62 · R29 · orchestratorWarnings: agentic-cli ⇒ [agentic_cli_slow]; llm ⇒ [] [H4a-R08]", () => {
    expect(orchestratorWarnings("agentic-cli")).toEqual(["agentic_cli_slow"]);
    expect(orchestratorWarnings("llm")).toEqual([]);
  });
});

describe("tenantOrchestratorProblem [HUB-FR-62 · H4a-R07 · H4a-AC-08]", () => {
  it("HUB-FR-62 · R30 · tenant vắng ⇒ not_found (kể cả exists=true) [H4a-R07]", () => {
    expect(tenantOrchestratorProblem(undefined, false)).toBe("not_found");
    expect(tenantOrchestratorProblem(undefined, true)).toBe("not_found");
  });
  it("HUB-FR-62 · R31 · tenant khoá ⇒ inactive, trước exists [H4a-R07]", () => {
    expect(tenantOrchestratorProblem({ active: false }, true)).toBe("inactive");
  });
  it("HUB-FR-62 · R32 · tenant active đã có bản ⇒ exists; chưa có ⇒ null [H4a-AC-08]", () => {
    expect(tenantOrchestratorProblem({ active: true }, true)).toBe("exists");
    expect(tenantOrchestratorProblem({ active: true }, false)).toBeNull();
  });
});

describe("isStudioRole [HUB-FR-72 · H4a-R01]", () => {
  it("HUB-FR-72 · R33 · chỉ platform_admin ⇒ true; tenant_admin, member ⇒ false [H4a-R01 · H4a-AC-01]", () => {
    expect(isStudioRole("platform_admin")).toBe(true);
    expect(isStudioRole("tenant_admin")).toBe(false);
    expect(isStudioRole("member")).toBe(false);
  });
});

describe("mô tả trùng ý (Jaccard) [HUB-FR-60 · H4a-R08 · CR-025]", () => {
  it("HUB-FR-60 · R34 · descriptionTokens: NFC + chữ thường + tách theo ký tự không chữ/số, bỏ token < 3 ký tự [H4a-R08]", () => {
    const nfd = "Hoá đơn, HOÁ ĐƠN! ab x1y2z";
    expect([...descriptionTokens(nfd)].sort()).toEqual(["hoá", "x1y2z", "đơn"].sort());
    expect(descriptionTokens("a bb").size).toBe(0);
  });
  it("HUB-FR-60 · R35 · descriptionOverlap = |A∩B|/|A∪B|; biên 3/5 = 0.6; hai tập rỗng ⇒ 0 [H4a-R08]", () => {
    expect(descriptionOverlap("alpha beta gamma delta", "alpha beta gamma epsilon")).toBeCloseTo(
      0.6,
      10,
    );
    expect(descriptionOverlap("alpha beta zeta theta", "alpha beta gamma delta")).toBeCloseTo(
      2 / 6,
      10,
    );
    expect(descriptionOverlap("ab", "cd")).toBe(0);
    expect(descriptionOverlap("Alpha BETA", "alpha beta")).toBe(1);
  });
  const t = { id: "t", description: "alpha beta gamma delta" };
  const o = (id: string, description: string, enabled = true) => ({
    id,
    key: `k-${id}`,
    description,
    enabled,
  });
  const idOf = (r: Record<string, unknown>) => (r.agent_id ?? r.id) as string;

  it("HUB-FR-60 · R36 · similarAgents: bỏ chính nó + agent tắt + score < 0.6; giữ đúng 0.6; sắp giảm dần [H4a-R08]", () => {
    const res = similarAgents(t, [
      o("t", t.description),
      o("b", "alpha beta gamma epsilon"),
      o("off", t.description, false),
      o("c", "alpha beta zeta theta"),
      o("same", "Delta gamma beta ALPHA"),
    ]) as Record<string, unknown>[];
    expect(res.map(idOf)).toEqual(["same", "b"]);
    expect(res[0]?.score).toBe(1);
  });
  it("HUB-FR-60 · R37 · similarAgents tối đa 5; threshold tuỳ chọn [H4a-R08]", () => {
    const many = Array.from({ length: 7 }, (_, i) => o(`m${i}`, t.description));
    expect(similarAgents(t, many)).toHaveLength(5);
    expect(
      (similarAgents(t, [o("c", "alpha beta zeta theta")], 0.3) as Record<string, unknown>[]).map(
        idOf,
      ),
    ).toEqual(["c"]);
  });
  it("HUB-FR-60 · R38 · formatAgentForOrchestrator = JSON.stringify({key, description}) (phần tử <agents> của prompt) [plan §2.2 E7]", () => {
    expect(formatAgentForOrchestrator({ key: "hoadon", description: 'Tra cứu "hoá đơn"' })).toBe(
      JSON.stringify({ key: "hoadon", description: 'Tra cứu "hoá đơn"' }),
    );
  });
});
