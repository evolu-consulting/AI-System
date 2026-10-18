// HUB-FR-144 · P-d1 T11c · plan-frontend §4: việc kiểm đã chuyển cấp ⇒ huy hiệu "Đã chuyển cấp" + câu giải thích (mockup 03 D4).
import { ArrowUpRight } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

export const EscalatedNote = memo(function EscalatedNote({ group }: { group?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-caption font-semibold text-warning">
        <ArrowUpRight className="size-3" aria-hidden />
        {t("process.run.review.escalated")}
      </span>
      {group ? (
        <p className="text-caption text-secondary-foreground">
          {t("process.run.review.escalatedNote", { group })}
        </p>
      ) : null}
    </div>
  );
});
