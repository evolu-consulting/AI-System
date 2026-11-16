// CR-177 U3 · RadioGroup (Radix): mũi tên chọn mục kế.
import { RadioGroup as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const RadioGroup = ({ className, ...p }: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="radio-group" className={cn("grid gap-2", className)} {...p} />
);
export const RadioGroupItem = ({ className, ...p }: React.ComponentProps<typeof P.Item>) => (
  <P.Item
    data-slot="radio-group-item"
    className={cn(
      "flex size-4 shrink-0 items-center justify-center rounded-full border border-input transition-colors duration-[var(--duration-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 data-[state=checked]:border-primary",
      className,
    )}
    {...p}
  >
    <P.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-primary" />
  </P.Item>
);
