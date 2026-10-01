// ADM-FR-14 · hàng lọc Workflows: chip trạng thái có số (Tất cả/Bật/Tắt/Chưa gắn), chip "Secret: NAME ✕", ô tìm.
import type { WorkflowListCounts } from "@ai/contracts";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { Button } from "@/components/ui/button";
import type { WorkflowStatusFilter } from "../hooks/use-workflow-queries";

type Status = "all" | WorkflowStatusFilter;

type Props = {
  status: Status;
  q: string;
  secret?: string;
  counts?: WorkflowListCounts;
  onStatus: (s: Status) => void;
  onQuery: (q: string) => void;
  onClearSecret: () => void;
};

export function WorkflowFilters({
  status,
  q,
  secret,
  counts,
  onStatus,
  onQuery,
  onClearSecret,
}: Props) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <FilterChips<Status>
        label={t("workflows.col.status")}
        value={status}
        onChange={onStatus}
        chips={[
          { value: "all", label: t("workflows.filter.all"), count: counts?.all },
          { value: "on", label: t("workflows.filter.on"), count: counts?.on },
          { value: "off", label: t("workflows.filter.off"), count: counts?.off },
          {
            value: "unattached",
            label: t("workflows.filter.unattached"),
            count: counts?.unattached,
          },
        ]}
      />
      {secret ? (
        <Button
          variant="outline"
          size="sm"
          aria-label={t("workflows.filter.clearSecret")}
          onClick={onClearSecret}
          className="rounded-full font-mono"
        >
          {t("workflows.filter.secret", { name: secret })}
          <X aria-hidden />
        </Button>
      ) : null}
      <div className="ml-auto w-full sm:w-auto">
        <SearchBox label={t("workflows.list.search")} value={q} onChange={onQuery} />
      </div>
    </div>
  );
}
