// ADM-FR-60, ADM-FR-04 · badge trạng thái ok/off/warn/info/err, tooltip tuỳ chọn (focus được bằng bàn phím).
// CR-177: dựng trên Badge chung (status + icon bắt buộc); tone cũ ánh xạ sang status của bộ chung.
import { Badge, type BadgeStatus } from "@ai/web-kit/ui/kit/badge";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import type { ReactNode } from "react";

export type StatusTone = "ok" | "off" | "warn" | "info" | "err";

const MAP: Record<StatusTone, BadgeStatus> = {
  ok: "ok",
  off: "idle",
  warn: "warn",
  info: "info",
  err: "bad",
};
const ICON: Record<BadgeStatus, keyof typeof ICONS> = {
  ok: "success",
  warn: "warning",
  bad: "reject",
  info: "info",
  idle: "neutral",
};

type Props = {
  tone: StatusTone;
  children: ReactNode;
  tooltip?: string;
  className?: string;
  title?: string;
};

export function StatusBadge({ tone, children, tooltip, className, title }: Props) {
  const status = MAP[tone];
  const Icon = ICONS[ICON[status]];
  const badge = (
    <Badge status={status} icon={<Icon aria-hidden="true" />} className={className} title={title}>
      {children}
    </Badge>
  );
  if (!tooltip) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: tooltip đọc được bằng bàn phím (plan §11) */}
        <span tabIndex={0} className="inline-flex rounded-full">
          {badge}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
