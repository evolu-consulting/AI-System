// ADM-FR-71 · P-b2 (plan-frontend §1): nội dung thẻ một giai đoạn — dùng chung cho nút canvas và dòng StepList.
// Tên truy cập của nút cha bắt đầu bằng "Giai đoạn n: <tên>" (e2e dùng regex); phần sau là executor/gate/huy hiệu.
import { CircleAlert, Clock, GitBranch, Lock, ShieldCheck, Wrench, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
        {name}
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
          <StatusBadge tone="err">
            <CircleAlert aria-hidden />
            {t("process.admin.canvas.node.error")}
          </StatusBadge>
        </>
      ) : null}
    </span>
  );
}

/** dlc-engine · bước DLC của khe: "Bước n: tên", việc + agent, cổng duyệt (+ huy hiệu Group duyệt); trộn với bước duyệt ⇒ huy hiệu lỗi. */
function DlcBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const s = v.dlc;
  if (!s) return null;
  const name = v.name || t("process.admin.editor.stage.unnamed");
  const action = t(`process.admin.library.dlc.action.${s.action}`, { defaultValue: s.action });
  return (
    <span className="block min-w-0 text-left">
      <span className="inline-block w-full truncate text-label font-medium" title={name}>
        {name}
      </span>{" "}
      <span className="inline-block w-full truncate text-caption text-muted-foreground">
        {`DLC · ${action}${s.agent ? ` · @${s.agent}` : ""}`}
      </span>{" "}
      <span className="inline-block w-full truncate text-caption text-muted-foreground">
        {s.gate ? (
          <>
            <ShieldCheck aria-hidden className="mr-1 inline size-3.5 align-text-bottom" />
            {t("process.admin.library.dlc.gateOn")}{" "}
            <StatusBadge tone="info" title={t("process.admin.library.dlc.gateGroup")}>
              {s.group}
            </StatusBadge>
          </>
        ) : (
          t("process.admin.library.dlc.gateOff")
        )}
      </span>
      {v.hasError ? (
        <>
          {" "}
          <StatusBadge tone="err">
            <CircleAlert aria-hidden />
            {t("process.admin.canvas.node.error")}
          </StatusBadge>
        </>
      ) : null}
    </span>
  );
}

export function StageBody({ v }: { v: StageView }) {
  if (v.sys) return <SystemPill v={v} />;
  if (v.dlc) return <DlcBody v={v} />;
  if (v.slotInfo) return <SlotBody v={v} />;
  return <PlainBody v={v} />;
}

/** Giai đoạn thường (không phải bước của khe). */
function PlainBody({ v }: { v: StageView }) {
  const { t } = useTranslation();
  const name = v.name || t("process.admin.editor.stage.unnamed");
  // CR-123 · u5 · node module nhiều stage (Ký số): MỘT dòng chỉ có tên — không lộ tên công cụ / huy hiệu kỹ thuật của stage đầu
  if (v.module)
    return (
      <span className="block min-w-0 text-left">
        <span className="inline-block w-full truncate text-label font-medium" title={name}>
          {name}
        </span>
      </span>
    );
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
            <StatusBadge tone="info">{t("process.admin.canvas.node.real")}</StatusBadge>
          </>
        ) : null}
        {v.autofix ? (
          <>
            {" "}
            <StatusBadge tone="info">{t("process.admin.autofix.title")}</StatusBadge>
          </>
        ) : null}
        {v.wait ? (
          <>
            {" "}
            <StatusBadge tone="info">
              <Clock aria-hidden />
              {t("process.admin.canvas.node.wait")}
            </StatusBadge>
          </>
        ) : null}
        {v.tool ? (
          <>
            {" "}
            <StatusBadge tone="info">
              <Wrench aria-hidden />
              {t("process.admin.canvas.node.tool")}
            </StatusBadge>
          </>
        ) : null}
        {v.sideEffect ? (
          <>
            {" "}
            <StatusBadge tone="warn">{t("process.admin.canvas.node.sideEffect")}</StatusBadge>
          </>
        ) : null}
        {v.branch.length > 0 ? (
          <>
            {" "}
            <StatusBadge tone="info">
              <GitBranch aria-hidden />
              {t("process.admin.canvas.node.branch", { count: v.branch.length })}
            </StatusBadge>
          </>
        ) : null}
        {v.apply ? (
          <>
            {" "}
            <StatusBadge tone="info">{t("process.admin.apply.kind")}</StatusBadge>
          </>
        ) : null}
        {v.backTo.map((s) => (
          <span key={s}>
            {" "}
            <StatusBadge tone="warn">
              {t("process.admin.canvas.node.back", { step: s + 1 })}
            </StatusBadge>
          </span>
        ))}
        {v.locked ? (
          <>
            {" "}
            <StatusBadge tone="info" title={t("process.admin.library.system.hint")}>
              <Lock aria-hidden />
              {t("process.admin.library.system.badge")}
            </StatusBadge>
          </>
        ) : null}
        {v.hasError ? (
          <>
            {" "}
            <StatusBadge tone="err">
              <CircleAlert aria-hidden />
              {t("process.admin.canvas.node.error")}
            </StatusBadge>
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
