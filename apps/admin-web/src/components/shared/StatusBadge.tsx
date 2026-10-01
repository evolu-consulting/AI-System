// ADM-FR-60, ADM-FR-04 · badge trạng thái ok/off/warn/info/err, tooltip tuỳ chọn (focus được bằng bàn phím).
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type StatusTone = "ok" | "off" | "warn" | "info" | "err";

type Props = { tone: StatusTone; children: ReactNode; tooltip?: string; className?: string };

export function StatusBadge({ tone, children, tooltip, className }: Props) {
  if (!tooltip) {
    return (
      <Badge variant={tone} className={className}>
        {children}
      </Badge>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: tooltip đọc được bằng bàn phím (plan §11) */}
        <span tabIndex={0} className="inline-flex rounded-full">
          <Badge variant={tone} className={className}>
            {children}
          </Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
