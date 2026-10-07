// HUB-FR-96 · phân cách ngày trong dòng thời gian: Hôm nay / Hôm qua / dd/MM/yyyy.
import { useTranslation } from "react-i18next";
import { dayLabelOf } from "../../lib/room-logic";

export function DayDivider({ day }: { day: string }) {
  const { t } = useTranslation();
  const label = dayLabelOf(day, new Date());
  const text = label.kind === "date" ? label.text : t(`rooms.${label.kind}`);
  return (
    <h3 className="my-3 flex items-center gap-3 text-caption font-medium text-muted-foreground">
      <span aria-hidden className="h-px flex-1 bg-border" />
      {text}
      <span aria-hidden className="h-px flex-1 bg-border" />
    </h3>
  );
}
