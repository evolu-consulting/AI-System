// ADM-FR-71 · P-b2 (plan-frontend §1): nội dung thẻ một giai đoạn — dùng chung cho nút canvas và dòng StepList.
// Tên truy cập của nút cha bắt đầu bằng "Giai đoạn n: <tên>" (e2e dùng regex); phần sau là executor/gate/huy hiệu.
import { CircleAlert, Clock, GitBranch, Lock, ShieldCheck, Wrench, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { StageView } from "./stage-view";

/** CR-105 UX · nút hệ thống của khe: viên thuốc xám nhỏ ("Hệ thống: chọn bước kế" / "Hệ thống: hoàn tất"). */
function SystemPill({ v }: { v: StageView }) {
  const { t } = useTranslation();
  return (
    <span className="flex h-full items-center justify-center">
      <span
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-caption text-muted-foreground"
        title={t("process.admin.library.system.hint")}
      >
        <Lock aria-hidden className="size-3" />
        {t(`process.admin.library.system.${v.sys}`)}
      </span>
    </span>
  );
}

/** CR-105 UX · bước duyệt của khe: "Bước n: tên", phòng ban + hạn, điều kiện bằng lời. */
function SlotBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const s = v.slotInfo;
  if (!s) return null;
  const name = v.name || t("process.admin.editor.stage.unnamed");
  return (
    <span className="block min-w-0 text-left">
      <span className="inline-block w-full truncate text-label font-medium" title={name}>
        {t("process.admin.library.canvas.stageAria", { n: s.no, name })}
      </span>{" "}
      <span className="inline-block w-full truncate text-caption text-muted-foreground">
        {s.dept || t("process.admin.library.canvas.noDept")}
        {s.dueH === null ? "" : ` · ${t("process.admin.library.canvas.due", { n: s.dueH })}`}
      </span>{" "}
      <span
        className="inline-block w-full truncate text-caption text-muted-foreground"
        title={s.cond ?? undefined}
      >
        {s.cond ?? t("process.admin.library.canvas.always")}
      </span>
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
  );
}

export function StageBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  if (v.sys) return <SystemPill v={v} />;
  if (v.slotInfo) return <SlotBody v={v} />;
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
        {v.autofix ? (
          <>
            {" "}
            <Badge variant="info">{t("process.admin.autofix.title")}</Badge>
          </>
        ) : null}
        {v.wait ? (
          <>
            {" "}
            <Badge variant="info">
              <Clock aria-hidden />
              {t("process.admin.canvas.node.wait")}
            </Badge>
          </>
        ) : null}
        {v.tool ? (
          <>
            {" "}
            <Badge variant="info">
              <Wrench aria-hidden />
              {t("process.admin.canvas.node.tool")}
            </Badge>
          </>
        ) : null}
        {v.sideEffect ? (
          <>
            {" "}
            <Badge variant="warn">{t("process.admin.canvas.node.sideEffect")}</Badge>
          </>
        ) : null}
        {v.branch.length > 0 ? (
          <>
            {" "}
            <Badge variant="info">
              <GitBranch aria-hidden />
              {t("process.admin.canvas.node.branch", { count: v.branch.length })}
            </Badge>
          </>
        ) : null}
        {v.apply ? (
          <>
            {" "}
            <Badge variant="info">{t("process.admin.apply.kind")}</Badge>
          </>
        ) : null}
        {v.backTo.map((s) => (
          <span key={s}>
            {" "}
            <Badge variant="warn">{t("process.admin.canvas.node.back", { step: s + 1 })}</Badge>
          </span>
        ))}
        {v.locked ? (
          <>
            {" "}
            <Badge variant="info" title={t("process.admin.library.system.hint")}>
              <Lock aria-hidden />
              {t("process.admin.library.system.badge")}
            </Badge>
          </>
        ) : null}
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
