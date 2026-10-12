// ADM-FR-71 · P-b2 (plan-frontend §1): nội dung thẻ một giai đoạn — dùng chung cho nút canvas và dòng StepList.
// Tên truy cập của nút cha bắt đầu bằng "Giai đoạn n: <tên>" (e2e dùng regex); phần sau là executor/gate/huy hiệu.
import { CircleAlert, ShieldCheck, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { StageView } from "./stage-view";

export function StageBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const name = v.name || t("process.admin.editor.stage.unnamed");
  // Chỉ dùng phần tử inline / inline-block cách nhau đúng một dấu cách ⇒ `innerText` là MỘT dòng (e2e so sánh chuỗi).
  return (
    <span className="block min-w-0 text-left">
      <span className="inline-block w-full truncate text-label font-medium" title={name}>
        {t("process.admin.editor.stage.aria", { n: v.index + 1, name })}
      </span>{" "}
      {v.executor ? (
        <>
          <span className="inline-block w-full truncate text-caption text-muted-foreground">
            {v.executor}
          </span>{" "}
        </>
      ) : null}
      <span className="inline-block w-full text-caption text-muted-foreground">
        {v.after === "review" ? (
          <ShieldCheck aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
        ) : (
          <Zap aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
        )}
        {t(`process.admin.canvas.node.${v.after === "review" ? "gateReview" : "gateAuto"}`)}
        {v.real ? (
          <>
            {" "}
            <Badge variant="info">{t("process.admin.canvas.node.real")}</Badge>
          </>
        ) : null}
        {v.backTo.map((s) => (
          <span key={s}>
            {" "}
            <Badge variant="warn">{t("process.admin.canvas.node.back", { step: s + 1 })}</Badge>
          </span>
        ))}
        {v.hasError ? (
          <>
            {" "}
            <Badge variant="err">
              <CircleAlert aria-hidden />
              {t("process.admin.canvas.node.error")}
            </Badge>
          </>
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
