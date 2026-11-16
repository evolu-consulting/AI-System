// CR-177 U3 · Tabs (Radix): mũi tên trái/phải, Home/End.
import { Tabs as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const Tabs = ({ className, ...p }: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="tabs" className={cn("flex flex-col gap-2", className)} {...p} />
);
export const TabsList = ({ className, ...p }: React.ComponentProps<typeof P.List>) => (
  <P.List
    data-slot="tabs-list"
    className={cn(
      "inline-flex h-[var(--control-md)] max-sm:h-auto items-center gap-1 rounded-md bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...p}
  />
);
export const TabsTrigger = ({ className, ...p }: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger
    data-slot="tabs-trigger"
    className={cn(
      "inline-flex items-center justify-center max-sm:min-h-11 rounded-sm px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors duration-[var(--duration-fast)] focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
      className,
    )}
    {...p}
  />
);
export const TabsContent = ({ className, ...p }: React.ComponentProps<typeof P.Content>) => (
  <P.Content data-slot="tabs-content" className={cn("outline-none", className)} {...p} />
);
