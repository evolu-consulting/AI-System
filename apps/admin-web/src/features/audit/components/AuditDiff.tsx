// ADM-FR-51 · BR-04 · diff của một dòng nhật ký: update Trước/Sau (có chữ "đã đổi"), create chỉ Sau, delete chỉ Trước, secret chỉ "Giá trị: đã thay đổi".
import type { AuditDetail } from "@ai/contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type DiffMode, DiffTable } from "@/components/shared/diff/DiffTable";
import { diffAll } from "@/lib/diff-fields";

export function AuditDiff({ entry }: { entry: AuditDetail }) {
  const { t } = useTranslation();
  const mode: DiffMode =
    entry.action === "create" ? "create" : entry.action === "delete" ? "delete" : "update";
  const { changed, unchanged } = useMemo(
    () => diffAll(entry.before, entry.after),
    [entry.before, entry.after],
  );
  if (entry.entity === "secret" || entry.summary.value_changed) {
    return <p className="text-body font-medium">{t("audit.diff.secret")}</p>;
  }
  return (
    <DiffTable
      rows={changed}
      unchanged={unchanged}
      mode={mode}
      markChanged={mode === "update"}
      labels={{
        caption: t("audit.diff.caption"),
        field: t("audit.diff.field"),
        before: t("audit.diff.before"),
        after: t("audit.diff.after"),
      }}
    />
  );
}
