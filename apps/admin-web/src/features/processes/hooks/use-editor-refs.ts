// ADM-FR-66 · CR-056 · P-a F5: danh sách chọn của editor — agent đã bật, nhóm agent, Group, người dùng của tenant đang xem.
import { isApproverGroup } from "@ai/contracts/groups";
import type { AgentSettingsResponse, ProcessToolItem } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { useAgentSettings, useAgentUserOptions } from "@/features/agents/api";
import { useGroupOptions } from "@/features/groups/api";
import { type SourceOption, useSourceOptions } from "@/features/sources/api";
import { pickLocalized } from "@/lib/localized";
import { useAgentTeams } from "../api";
import type { Option } from "../components/editor/Fields";
import type { TeamSections } from "../lib/wait-form";
import { useProcessTools } from "./use-process-tools";

export type EditorRefs = {
  agents: Option[];
  /** dlc-engine · khoá + tên agent bật (gợi ý ô agent của bước DLC); vắng ở bản giả của test. */
  agentKeys?: { key: string; label: string }[];
  teams: Option[];
  groups: Option[];
  /** CR-125 · x3 · nhóm CHỌN LÀM NGƯỜI DUYỆT được (phòng ban, chức danh): bỏ nhóm kỹ thuật (`isApproverGroup`, một nguồn ở contracts). Vắng ⇒ dùng `groups`. */
  approverGroups?: Option[];
  users: Option[];
  /** Nguồn của công ty (kind để dựng nhãn ô "Nguồn" của Tự sửa mã). */
  sources: SourceOption[];
  /** P-d1 · team_id → chế độ + mục từng thành viên, cho luật `TEAM_SECTION_UNOWNED` (`processDefStageIssues` ctx.teams). */
  teamSections: TeamSections;
  /** P-d2 · catalog tool khả dụng (undefined = chưa nạp ⇒ bỏ kiểm theo catalog). */
  tools: readonly ProcessToolItem[] | undefined;
  /** Có danh sách nào còn đang tải. */
  loading: boolean;
};

/** Thêm mục "(không còn)" cho giá trị đang chọn nhưng đã vắng khỏi danh sách (agent/nhóm/Group bị tắt hoặc xoá). */
export function withCurrent(opts: Option[], value: string, gone: string): Option[] {
  if (value === "" || opts.some((o) => o.value === value)) return opts;
  return [...opts, { value, label: gone }];
}

/** dlc-engine · khoá + tên agent BẬT (bước DLC chọn agent theo khoá — def thư viện / bước mẫu dùng chung nhiều tenant). */
export const agentKeysOf = (
  agents: AgentSettingsResponse["agents"],
  lang: "vi" | "en",
): { key: string; label: string }[] =>
  agents.filter((a) => a.enabled).map((a) => ({ key: a.agent.key, label: a.agent.name[lang] }));

export function useEditorRefs(tenantId: string | undefined, enabled: boolean): EditorRefs {
  const { i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const settings = useAgentSettings(tenantId, enabled);
  const teams = useAgentTeams(tenantId, enabled);
  const groups = useGroupOptions(tenantId, enabled);
  const users = useAgentUserOptions(tenantId, enabled);
  const sources = useSourceOptions(tenantId, enabled);
  const { tools } = useProcessTools();
  return {
    tools,
    agents: (settings.data?.agents ?? [])
      .filter((a) => a.entitled && a.enabled)
      .map((a) => ({ value: `agent:${a.agent.id}`, label: a.agent.name[lang] })),
    agentKeys: agentKeysOf(settings.data?.agents ?? [], lang),
    teams: (teams.data?.items ?? []).map((x) => ({ value: `team:${x.id}`, label: x.name[lang] })),
    groups: (groups.data ?? []).map((g) => ({ value: g.id, label: pickLocalized(g.name, lang) })),
    approverGroups: (groups.data ?? [])
      .filter(isApproverGroup)
      .map((g) => ({ value: g.id, label: pickLocalized(g.name, lang) })),
    users: (users.data ?? []).map((u) => ({ value: u.id, label: u.name || u.username })),
    sources: sources.data ?? [],
    teamSections: new Map(
      (teams.data?.items ?? []).map((x) => [
        x.id,
        { mode: x.mode, memberSections: x.members.map((m) => m.sections) },
      ]),
    ),
    loading: settings.isPending || teams.isPending || groups.isPending || users.isPending,
  };
}
