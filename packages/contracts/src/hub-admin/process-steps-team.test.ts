// HUB-FR-143 · D7 · TEAM_SECTION_UNOWNED (FE validate live; cùng điều kiện + path với luật domain).
import { describe, expect, it } from "bun:test";
import {
  PROCESS_DEF_RULES,
  processDefStageIssues,
  type TeamSectionsInfo,
  teamSectionIssues,
} from "./process-steps";

const teams = new Map<string, TeamSectionsInfo>([
  ["seq", { mode: "sequential", memberSections: [["A"], ["B"]] }],
  ["lead", { mode: "lead_plan", memberSections: [["A"]] }],
]);
const st = (teamId: string, req: string[]) => ({
  key: "k",
  real_action: false,
  after: { kind: "auto" },
  executor: { kind: "team", team_id: teamId },
  output: { required_sections: req },
});

describe("teamSectionIssues", () => {
  it("rule nằm trong PROCESS_DEF_RULES", () => {
    expect(PROCESS_DEF_RULES).toContain("TEAM_SECTION_UNOWNED");
  });
  it("mục không ai phụ trách ⇒ issue tại stages.<i>.output.required_sections", () => {
    expect(teamSectionIssues([st("seq", ["A", "C"])], teams)).toEqual([
      { path: "stages.0.output.required_sections", rule: "TEAM_SECTION_UNOWNED" },
    ]);
  });
  it("đủ mục / lead_plan / không có ctx.teams ⇒ không lỗi", () => {
    expect(teamSectionIssues([st("seq", ["A", "B"]), st("lead", ["Z"])], teams)).toEqual([]);
    expect(processDefStageIssues([st("seq", ["Z"])] as never)).toEqual([]);
  });
  it("processDefStageIssues nhận ctx.teams", () => {
    expect(processDefStageIssues([st("seq", ["Z"])] as never, { teams })).toEqual([
      { path: "stages.0.output.required_sections", rule: "TEAM_SECTION_UNOWNED" },
    ]);
  });
});
