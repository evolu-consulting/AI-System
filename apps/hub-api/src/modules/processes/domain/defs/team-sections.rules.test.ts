// HUB-FR-143 · D7 · luật mục bắt buộc của stage team.
import { describe, expect, it } from "bun:test";
import { type TeamSectionsInfo, teamSectionIssues } from "./team-sections.rules";

const stage = (teamId: string | null, req: string[], kind = "team") => ({
  executorKind: kind,
  teamId,
  requiredSections: req,
});
const teams = new Map<string, TeamSectionsInfo>([
  ["seq", { mode: "sequential", memberSections: [["A"], ["B", "C"]] }],
  ["par", { mode: "parallel_merge", memberSections: [["A"]] }],
  ["lead", { mode: "lead_plan", memberSections: [] }],
]);

describe("teamSectionIssues", () => {
  it("mọi mục có người phụ trách ⇒ không lỗi", () => {
    expect(teamSectionIssues([stage("seq", ["A", "B", "C"])], teams)).toEqual([]);
  });
  it("sequential: mục không ai giao ⇒ lỗi tại stages.<i>.output.required_sections, tên mục", () => {
    const [it0] = teamSectionIssues([stage(null, [], "agent"), stage("seq", ["A", "D"])], teams);
    expect(it0?.path).toBe("stages.1.output.required_sections");
    expect(it0?.rule).toBe("TEAM_SECTION_UNOWNED");
    expect(it0?.sections).toEqual(["D"]);
    expect(it0?.message).toContain("D");
  });
  it("parallel_merge: gộp nhiều mục thiếu", () => {
    expect(teamSectionIssues([stage("par", ["A", "X", "Y"])], teams)[0]?.sections).toEqual([
      "X",
      "Y",
    ]);
  });
  it("lead_plan miễn; nhóm lạ / stage agent bỏ qua", () => {
    expect(teamSectionIssues([stage("lead", ["Z"]), stage("nope", ["Z"])], teams)).toEqual([]);
    expect(teamSectionIssues([stage("seq", ["Z"], "agent")], teams)).toEqual([]);
  });
});
