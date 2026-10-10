// CR-056 · P-a plan-frontend §6: huy hiệu trạng thái run (màu theo token theme, không hex). Chữ + màu, không chỉ màu (a11y).
import type { ProcessRunStatus } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";
import { runStatusKey, type StatusTone, statusTone } from "../lib/status";

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-strong-foreground",
  info: "bg-accent text-accent-foreground",
  warn: "bg-warning-bg text-warning",
  success: "bg-success-bg text-success",
  danger: "bg-destructive/10 text-destructive",
};

export const RunStatusBadge = memo(function RunStatusBadge({
  status,
  className,
}: {
  status: ProcessRunStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      data-status={status}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-caption font-semibold",
        TONE_CLASS[statusTone(status)],
        className,
      )}
    >
      {t(runStatusKey(status))}
    </span>
  );
});
