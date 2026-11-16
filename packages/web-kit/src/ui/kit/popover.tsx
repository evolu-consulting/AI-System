// CR-177 U3 · Popover (Radix): Esc đóng, trả focus về nút mở.
import { Popover as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const Popover = (props: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="popover" {...props} />
);
export const PopoverTrigger = (props: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger data-slot="popover-trigger" {...props} />
);
export const PopoverAnchor = (props: React.ComponentProps<typeof P.Anchor>) => (
  <P.Anchor data-slot="popover-anchor" {...props} />
);

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof P.Content>) {
  return (
    <P.Portal>
      <P.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          className,
        )}
        {...props}
      />
    </P.Portal>
  );
}
