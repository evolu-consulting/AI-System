// CR-103 · R1 · node `team`: nhóm agent chạy stage (C2, HUB-FR-143). Phần thuần (kiểm def, cờ năng lực).
import { NODE_FAMILY_OF } from "@ai/contracts/hub-admin";
import { teamSectionIssues } from "../../domain/defs/team-sections.rules";
import type { NodeSpec } from "../types";

export const teamNode: NodeSpec<"team"> = {
  kind: "team",
  family: NODE_FAMILY_OF.team,
  produces: "declared",
  realAction: false,
  handoff: false,
  refMiss(ex, p, refs) {
    return refs.teamIds.has(ex.team_id) ? null : { path: `${p}.executor.team_id`, ref: "team" };
  },
  /** HUB-FR-143 · mục bắt buộc của stage team phải có thành viên phụ trách (xét mọi stage như cũ). */
  defIssues(d, refs) {
    return teamSectionIssues(
      d.stages.map((s) => ({
        executorKind: s.executor.kind,
        teamId: s.executor.kind === "team" ? s.executor.team_id : null,
        requiredSections: s.output.required_sections,
      })),
      refs.teams ?? new Map(),
    );
  },
};
