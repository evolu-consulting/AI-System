// CR-121 C-1b · nhóm lọc của /commands: Trạng thái (Bật/Tắt, có số), Feature, Workflow — mỗi nhóm đúng một control trong phễu.
import type { CommandListCounts } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import type { FilterGroup } from "@/components/shared/list/list-filter";
import { pickLocalized } from "@/lib/localized";
import { useFeatureOptions, useWorkflowOptions } from "../../hooks/use-command-queries";

type Sel = { status?: string; feature?: string; workflow?: string };

export function useCommandFilterGroups(sel: Sel, counts?: CommandListCounts): FilterGroup[] {
  const { t, i18n } = useTranslation();
  const features = useFeatureOptions();
  const workflows = useWorkflowOptions();
  return [
    {
      id: "status",
      label: t("commands.list.col.status"),
      value: sel.status,
      options: [
        { value: "on", label: t("common.on"), count: counts?.on },
        { value: "off", label: t("common.off"), count: counts?.off },
      ],
    },
    {
      id: "feature",
      label: t("commands.list.filter.feature"),
      value: sel.feature,
      options: (features.data ?? []).map((f) => ({
        value: f.id,
        label: pickLocalized(f.name, i18n.language),
      })),
    },
    {
      id: "workflow",
      label: t("commands.list.filter.workflow"),
      value: sel.workflow,
      options: (workflows.data?.items ?? []).map((w) => ({ value: w.id, label: w.key })),
    },
  ];
}
