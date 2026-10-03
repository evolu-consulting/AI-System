// CHAT-AC-10, CHAT-AC-11 · "Đã dừng" xám + nút nhỏ "Chạy lại".
import { useTranslation } from "react-i18next";

export function CancelledNote({ onRerun }: { onRerun?: () => void }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-caption text-muted-foreground">
      <span>{t("run.cancelled")}</span>
      {onRerun && (
        <button type="button" onClick={onRerun} className="underline hover:text-foreground">
          {t("run.rerun")}
        </button>
      )}
    </p>
  );
}
