// dlc-step-library · danh sách chọn của form "Bước DLC": agent bật (khoá, cùng nguồn với editor quy trình — tenant đang xem) và
// mã Group duyệt gợi ý (Group của các khe `dlc.*` + `dlc-editor`).
import { useTranslation } from "react-i18next";
import { useAgentSettings } from "@/features/agents/api";
import type { GroupOption } from "../components/library/flow-step-props";
import { DLC_GROUP_EDITOR, isDlcSlotKey } from "../lib/dlc-slot";
import { useSlots } from "../library-api";
import { agentKeysOf } from "./use-editor-refs";
import { useProcessTenant } from "./use-process-tenant";

export function useDlcStepOptions() {
  const { i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const tenant = useProcessTenant();
  const settings = useAgentSettings(tenant.tenantId, tenant.ready);
  const slots = useSlots(true);
  const groups = new Map<string, GroupOption>([[DLC_GROUP_EDITOR, { key: DLC_GROUP_EDITOR }]]);
  for (const s of slots.data ?? [])
    if (isDlcSlotKey(s.slot)) for (const g of s.group_keys ?? []) groups.set(g.key, g);
  return {
    agents: agentKeysOf(settings.data?.agents ?? [], lang),
    groups: [...groups.values()],
    // agent bật theo tenant ⇒ platform_admin chọn công ty lấy danh sách agent (chung lựa chọn với màn Quy trình)
    tenant,
  };
}
