// HUB-BR-17 · HUB-FR-78 · H3b-R04 · HUB-H3b-AC-02, AC-03 · test-plan-cases H3b §1.2 R10–R15: `grantProblem` — thứ tự
// lỗi khi cấp (agent vắng → Orchestrator → chưa entitlement → subject sai), không phụ thuộc role.
import { describe, expect, it } from "bun:test";
import {
  type GrantCheck,
  type GrantProblem,
  grantProblem,
} from "../../../../apps/hub-api/src/modules/agent-grants/agent-grants.rules";

const ag = (isOrchestrator: boolean, entitled: boolean) => ({ isOrchestrator, entitled });

describe("grantProblem [HUB-BR-17 · H3b-R04 · HUB-H3b-AC-02, AC-03]", () => {
  it("HUB-BR-17 · R10 · agent null (subject đúng · sai) ⇒ AGENT_NOT_FOUND_REF — lỗi agent che lỗi subject [H3b-R04]", () => {
    expect(grantProblem({ agent: null, subjectInTenant: true })).toBe("AGENT_NOT_FOUND_REF");
    expect(grantProblem({ agent: null, subjectInTenant: false })).toBe("AGENT_NOT_FOUND_REF");
  });

  it("HUB-BR-17 · R11 · Orchestrator (entitled true/false), subject sai ⇒ AGENT_NOT_GRANTABLE [H3b-R04 · HUB-H3b-AC-02]", () => {
    expect(grantProblem({ agent: ag(true, true), subjectInTenant: false })).toBe(
      "AGENT_NOT_GRANTABLE",
    );
    expect(grantProblem({ agent: ag(true, false), subjectInTenant: false })).toBe(
      "AGENT_NOT_GRANTABLE",
    );
  });

  it("HUB-BR-17 · R12 · không Orchestrator, chưa entitlement, subject sai ⇒ NOT_ENTITLED [H3b-R04 · HUB-H3b-AC-02]", () => {
    expect(grantProblem({ agent: ag(false, false), subjectInTenant: false })).toBe("NOT_ENTITLED");
  });

  it("HUB-BR-17 · R13 · agent hợp lệ, subject ngoài tenant ⇒ SUBJECT_NOT_FOUND_REF [H3b-R04 · HUB-H3b-AC-03]", () => {
    expect(grantProblem({ agent: ag(false, true), subjectInTenant: false })).toBe(
      "SUBJECT_NOT_FOUND_REF",
    );
  });

  it("HUB-BR-17 · R14 · agent hợp lệ + subject trong tenant ⇒ null [H3b-R04]", () => {
    expect(grantProblem({ agent: ag(false, true), subjectInTenant: true })).toBeNull();
  });

  it("HUB-BR-17 · R15 · đủ 10 tổ hợp (null × 2 + 2×2×2) theo đúng thứ tự R04; gọi 2 lần cùng input ⇒ cùng kết quả (không nhận role — P không bỏ qua) [H3b-R04]", () => {
    const c = (o: boolean, en: boolean, sub: boolean): GrantCheck => ({
      agent: ag(o, en),
      subjectInTenant: sub,
    });
    // viết tay theo thứ tự R04: agent vắng → Orchestrator → chưa entitlement → subject sai
    const rows: [GrantCheck, GrantProblem | null][] = [
      [{ agent: null, subjectInTenant: true }, "AGENT_NOT_FOUND_REF"],
      [{ agent: null, subjectInTenant: false }, "AGENT_NOT_FOUND_REF"],
      [c(true, true, true), "AGENT_NOT_GRANTABLE"],
      [c(true, true, false), "AGENT_NOT_GRANTABLE"],
      [c(true, false, true), "AGENT_NOT_GRANTABLE"],
      [c(true, false, false), "AGENT_NOT_GRANTABLE"],
      [c(false, false, true), "NOT_ENTITLED"],
      [c(false, false, false), "NOT_ENTITLED"],
      [c(false, true, false), "SUBJECT_NOT_FOUND_REF"],
      [c(false, true, true), null],
    ];
    expect(rows.length).toBe(10);
    const got = rows.map(([c]) => grantProblem(c));
    expect(got).toEqual(rows.map(([, w]) => w));
    expect(rows.map(([c]) => grantProblem(structuredClone(c)))).toEqual(got);
  });
});
