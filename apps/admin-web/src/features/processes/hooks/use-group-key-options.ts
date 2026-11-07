// CR-123 u9 · Group của công ty theo KHOÁ (không phải id) cho ô "Gửi cho" của node Thông báo; gọi API ở hook (component không fetch).
import { useTranslation } from "react-i18next";
import { useGroupOptions } from "@/features/groups/api";
import { pickLocalized } from "@/lib/localized";
import type { Option } from "../components/editor/Fields";

export function useGroupKeyOptions(tenantId: string | undefined, enabled: boolean): Option[] {
  const { i18n } = useTranslation();
  const groups = useGroupOptions(tenantId, enabled);
  return (groups.data ?? []).map((g) => ({
    value: g.key,
    label: pickLocalized(g.name, i18n.language),
  }));
}
