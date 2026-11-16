// CR-177 U3 · ToggleGroup (Radix): mũi tên di chuyển giữa các nút.
import { ToggleGroup as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const ToggleGroup = ({ className, ...p }: React.ComponentProps<typeof P.Root>) => (
  <P.Root
    data-slot="toggle-group"
    className={cn("inline-flex items-center rounded-md border", className)}
    {...p}
  />
);
export const ToggleGroupItem = ({ className, ...p }: React.ComponentProps<typeof P.Item>) => (
  <P.Item
    data-slot="toggle-group-item"
    className={cn(
      "inline-flex h-[var(--control-md)] max-sm:min-h-11 max-sm:min-w-11 items-center justify-center px-3 text-sm transition-colors duration-[var(--duration-fast)] first:rounded-l-md last:rounded-r-md hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground",
      className,
    )}
    {...p}
  />
);
