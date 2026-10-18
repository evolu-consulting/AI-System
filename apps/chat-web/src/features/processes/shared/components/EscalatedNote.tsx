// HUB-FR-144 · P-d1 T11c · plan-frontend §4: việc kiểm đã chuyển cấp ⇒ huy hiệu "Đã chuyển cấp" + câu giải thích (mockup 03 D4).
// P-d2 · D2-47: có `hours` (từ `history[escalate].after_h`) ⇒ câu nêu số giờ chờ ("… vì chưa ai kiểm sau 24 giờ").
import { ArrowUpRight } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

type Props = { group?: string; hours?: number };

export const EscalatedNote = memo(function EscalatedNote({ group, hours }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <span className="inline-flex w-fit items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-caption font-semibold text-warning">
        <ArrowUpRight className="size-3" aria-hidden />
        {t("process.run.review.escalated")}
      </span>
      {group ? (
        <p className="text-caption text-secondary-foreground">
          {hours === undefined
            ? t("process.run.review.escalatedNote", { group })
            : t("process.run.review.escalatedNoteH", { group, hours })}
        </p>
      ) : null}
    </div>
  );
});
