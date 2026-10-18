// HUB-FR-143 · D7/P1-31 · luật lưu def cho stage `team`: mục bắt buộc phải có thành viên phụ trách. Thuần, lớp 1.
// `lead_plan` miễn (mục không giao được lấp "—" lúc chạy); sequential / parallel_merge thì không.
export type TeamStageShape = {
  executorKind: string;
  teamId: string | null;
  requiredSections: readonly string[];
};
/** `memberSections`: mỗi phần tử = `sections` của một thành viên. */
export type TeamSectionsInfo = { mode: string; memberSections: readonly (readonly string[])[] };
export type TeamSectionIssue = {
  path: string;
  rule: "TEAM_SECTION_UNOWNED";
  message: string;
  sections: string[];
};

export function teamSectionIssues(
  stages: readonly TeamStageShape[],
  teams: ReadonlyMap<string, TeamSectionsInfo>,
): TeamSectionIssue[] {
  const out: TeamSectionIssue[] = [];
  for (const [i, s] of stages.entries()) {
    const team = s.executorKind === "team" && s.teamId !== null ? teams.get(s.teamId) : undefined;
    if (!team || team.mode === "lead_plan") continue;
    const owned = new Set(team.memberSections.flat());
    const sections = s.requiredSections.filter((r) => !owned.has(r));
    if (sections.length)
      out.push({
        path: `stages.${i}.output.required_sections`,
        rule: "TEAM_SECTION_UNOWNED",
        message: `Mục bắt buộc không thành viên nào phụ trách: ${sections.join(", ")}`,
        sections,
      });
  }
  return out;
}
