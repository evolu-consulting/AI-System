// CR-177 · Tooltip (Radix): trễ 250ms, Esc đóng. Mỗi Tooltip tự bọc Provider để dùng độc lập.
import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "./cn";

export const TOOLTIP_DELAY_MS = 250;

export function Tooltip({
  delayDuration = TOOLTIP_DELAY_MS,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root data-slot="tooltip" delayDuration={delayDuration} {...props} />
    </TooltipPrimitive.Provider>
  );
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-w-72 rounded-sm bg-ink-strong px-2.5 py-1.5 text-xs text-on-ink shadow-md",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
