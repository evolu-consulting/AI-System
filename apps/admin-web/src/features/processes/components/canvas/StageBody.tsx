// ADM-FR-71 · P-b2 (plan-frontend §1): nội dung thẻ một giai đoạn — dùng chung cho nút canvas và dòng StepList.
// Tên truy cập của nút cha bắt đầu bằng "Giai đoạn n: <tên>" (e2e dùng regex); phần sau là executor/gate/huy hiệu.
import { CircleAlert, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { StageView } from "./stage-view";

export function StageBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const name = v.name || t("process.admin.editor.stage.unnamed");
  return (
    <span className="flex min-w-0 flex-col gap-1 text-left">
      <span className="truncate text-label font-medium" title={name}>
        {t("process.admin.editor.stage.aria", { n: v.index + 1, name })}
      </span>
      {v.executor ? (
        <span className="truncate text-caption text-muted-foreground">{v.executor}</span>
      ) : null}
      <span className="flex flex-wrap items-center gap-1 text-caption text-muted-foreground">
        {v.after === "review" ? (
          <ShieldCheck aria-hidden className="size-3.5" />
        ) : (
          <Zap aria-hidden className="size-3.5" />
        )}
        <span>
          {t(`process.admin.canvas.node.${v.after === "review" ? "gateReview" : "gateAuto"}`)}
        </span>
        {v.real ? <Badge variant="info">{t("process.admin.canvas.node.real")}</Badge> : null}
        {v.backTo.map((s) => (
          <Badge key={s} variant="warn">
            {t("process.admin.canvas.node.back", { step: s + 1 })}
          </Badge>
        ))}
        {v.hasError ? (
          <Badge variant="err">
            <CircleAlert aria-hidden />
            {t("process.admin.canvas.node.error")}
          </Badge>
        ) : null}
      </span>
    </span>
  );
}

/** Lớp viền theo trạng thái (chọn / lỗi) — chỉ dùng token theme. */
export const stageButtonClass = (v: StageView, selected: boolean): string =>
  [
    "w-full rounded-md border bg-card p-2 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    v.hasError ? "border-destructive" : selected ? "border-primary" : "border-border",
    selected ? "ring-2 ring-primary/30" : "",
  ].join(" ");
