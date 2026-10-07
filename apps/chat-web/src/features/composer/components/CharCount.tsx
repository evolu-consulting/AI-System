// HUB-FR-96 · bộ đếm ký tự của composer phòng: hiện từ 90 % giới hạn, đỏ khi vượt.
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

export function CharCount({ length, max }: { length: number; max: number }) {
  const { t } = useTranslation();
  if (length < max * 0.9) return null;
  return (
    <p
      className={cn(
        "mt-1 text-right text-caption",
        length > max ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {t("rooms.composer.count", { n: length })}
    </p>
  );
}
