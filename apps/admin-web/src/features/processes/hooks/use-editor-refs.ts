// ADM-FR-66 · CR-056 · P-a F5: danh sách chọn của editor — agent đã bật, nhóm agent, Group, người dùng của tenant đang xem.
import type { ProcessToolItem } from "@ai/contracts/hub-admin";
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
  teams: Option[];
  groups: Option[];
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
    teams: (teams.data?.items ?? []).map((x) => ({ value: `team:${x.id}`, label: x.name[lang] })),
    groups: (groups.data ?? []).map((g) => ({ value: g.id, label: pickLocalized(g.name, lang) })),
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
