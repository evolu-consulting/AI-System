// HUB-FR-113 · plan-frontend §5 (A5): "Lịch sử quay lại" — mỗi lần quay lại một dòng theo thời gian; góp ý cắt 2 dòng, mở bằng
// "Xem đầy đủ". Chỉ view `full` có `back_events`; rỗng ⇒ không vẽ (người ngoài phòng không có khối này — AC-PB2-11).
import type { BackEvent, StageView } from "@ai/contracts/chat";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { formatDateTime } from "../../shared/lib/format";
import { stepNo } from "../../shared/lib/steps";

function Item({ e, stage, lng }: { e: BackEvent; stage: string; lng: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const textId = useId();
  const long = e.feedback.length > 120 || e.feedback.includes("\n");
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3 text-caption">
      <span className="text-secondary-foreground">
        {t("process.run.back.item", {
          round: e.round,
          by: e.by.display_name,
          stage,
          step: stepNo(e.to_step),
          time: formatDateTime(e.at, lng),
        })}
      </span>
      <q
        id={textId}
        className={cn("whitespace-pre-wrap wrap-anywhere text-foreground", !open && "line-clamp-2")}
      >
        {e.feedback}
      </q>
      {long && !open && (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={textId}
          onClick={() => setOpen(true)}
          className="self-start text-primary-strong hover:underline"
        >
          {t("process.run.back.more")}
        </button>
      )}
    </li>
  );
}

export function BackTimeline({
  events,
  stages,
}: {
  events: readonly BackEvent[];
  stages: readonly StageView[];
}) {
  const { t, i18n } = useTranslation();
  if (events.length === 0) return null;
  const lng = i18n.language === "vi" ? "vi" : "en";
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">{t("process.run.back.title")}</h3>
      <ol aria-label={t("process.run.back.title")} className="flex flex-col gap-2">
        {events.map((e) => (
          <Item
            key={`${e.at}-${e.from_stage_idx}`}
            e={e}
            stage={stages.find((s) => s.idx === e.from_stage_idx)?.name ?? ""}
            lng={lng}
          />
        ))}
      </ol>
    </section>
  );
}
