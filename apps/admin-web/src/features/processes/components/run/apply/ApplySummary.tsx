// HUB-FR-129 · P-c2 §1.3 · dòng tóm tắt Áp ở thẻ thread/khối quy trình: "Áp bản sửa" · trạng thái · `#n ↗` (FC12).
import type { ApplyStageView } from "@ai/contracts/chat";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { ApplyPrLink } from "./ApplyPrLink";

const K = "process.common.apply.";
const TONE = {
  pr_opened: "ok",
  pushed: "ok",
  branch_only: "info",
  no_changes: "off",
  conflict: "err",
  check_failed: "err",
  failed: "err",
} as const;

export function ApplySummary({ view }: { view: ApplyStageView }) {
  const { t } = useTranslation();
  const label =
    view.status === "conflict"
      ? t(`${K}status.conflict`, { n: view.conflict_files.length })
      : t(`${K}status.${view.status}`);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
      <Badge variant="info">{t(`${K}title`)}</Badge>
      <Badge variant={TONE[view.status]}>{label}</Badge>
      <ApplyPrLink view={view} short />
    </div>
  );
}
