// CR-103 fnr-cleanup · kiểu tham chiếu của luật def quy trình — module LÁ (chỉ type), để `nodes/*` không import ngược `def.rules` (gỡ vòng import).
import type { TeamSectionsInfo } from "../domain/defs/team-sections.rules";
import type { ToolDefShape } from "../domain/defs/tool-def.rules";

export type DefRefs = {
  agentIds: ReadonlySet<string>;
  teamIds: ReadonlySet<string>;
  groupIds: ReadonlySet<string>;
  userIds: ReadonlySet<string>;
  /** HUB-FR-143 · nhóm → chế độ + mục từng thành viên (vắng ⇒ bỏ kiểm mục bắt buộc stage team). */
  teams?: ReadonlyMap<string, TeamSectionsInfo>;
  /** P-d2 · D2-14 · TT-R05 · tool khả dụng của tenant (key → tham số); vắng/def mẫu ⇒ rỗng ⇒ stage tool = REF_INVALID. */
  tools?: ReadonlyMap<string, ToolDefShape>;
};
export type RefKind = "agent" | "team" | "group" | "user" | "source" | "tool";
export type RefMiss = { path: string; ref: RefKind };
