// ADM-FR-20 · hàng lọc Commands: chip trạng thái có số, Select Feature, Select Workflow, ô tìm. Mọi giá trị nằm trên URL.
import type { CommandListCounts } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { SearchBox } from "@/components/shared/form/SearchBox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pickLocalized } from "@/lib/localized";
import { useFeatureOptions, useWorkflowOptions } from "../hooks/use-command-queries";

type Status = "all" | "on" | "off";
const ALL = "all";

type Props = {
  status: Status;
  feature?: string;
  workflow?: string;
  q: string;
  counts?: CommandListCounts;
  onStatus: (s: Status) => void;
  onFeature: (id: string | undefined) => void;
  onWorkflow: (id: string | undefined) => void;
  onQuery: (q: string) => void;
};

export function CommandFilters(p: Props) {
  const { t, i18n } = useTranslation();
  const features = useFeatureOptions();
  const workflows = useWorkflowOptions();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <FilterChips<Status>
        label={t("commands.list.col.status")}
        value={p.status}
        onChange={p.onStatus}
        chips={[
          { value: "all", label: t("common.all"), count: p.counts?.all },
          { value: "on", label: t("common.on"), count: p.counts?.on },
          { value: "off", label: t("common.off"), count: p.counts?.off },
        ]}
      />
      <Select
        value={p.feature ?? ALL}
        onValueChange={(v) => p.onFeature(v === ALL ? undefined : v)}
      >
        <SelectTrigger aria-label={t("commands.list.filter.feature")} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("commands.list.filter.allFeatures")}</SelectItem>
          {(features.data ?? []).map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {pickLocalized(f.name, i18n.language)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={p.workflow ?? ALL}
        onValueChange={(v) => p.onWorkflow(v === ALL ? undefined : v)}
      >
        <SelectTrigger aria-label={t("commands.list.filter.workflow")} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("commands.list.filter.allWorkflows")}</SelectItem>
          {(workflows.data?.items ?? []).map((w) => (
            <SelectItem key={w.id} value={w.id} className="font-mono">
              {w.key}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("commands.list.search")} value={p.q} onChange={p.onQuery} />
      </div>
    </div>
  );
}
