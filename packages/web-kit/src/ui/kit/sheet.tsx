// CR-177 U3 · Sheet (thay DockSheet): trượt từ phải hoặc dưới; Esc đóng, aria-modal, giữ focus (Radix Dialog).
import { XIcon } from "lucide-react";
import { Dialog as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const Sheet = (props: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="sheet" {...props} />
);
export const SheetTrigger = (props: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger data-slot="sheet-trigger" {...props} />
);
export const SheetClose = (props: React.ComponentProps<typeof P.Close>) => (
  <P.Close data-slot="sheet-close" {...props} />
);

export type SheetSide = "right" | "bottom" | "left";
export const SHEET_SIDE_CLASS: Record<SheetSide, string> = {
  right:
    "inset-y-0 right-0 h-full w-3/4 max-w-sm border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right",
  left: "inset-y-0 left-0 h-full w-3/4 max-w-sm border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left",
  bottom:
    "inset-x-0 bottom-0 max-h-[90vh] rounded-t-lg border-t data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
};

export function SheetContent({
  className,
  children,
  side = "right",
  closeLabel = "Đóng",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof P.Content> & {
  side?: SheetSide;
  closeLabel?: string;
  showCloseButton?: boolean;
}) {
  return (
    <P.Portal>
      <P.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
      />
      <P.Content
        data-slot="sheet-content"
        data-side={side}
        aria-modal="true"
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-background p-4 shadow-lg outline-none duration-[var(--duration-fast)] data-[state=open]:animate-in data-[state=closed]:animate-out",
          SHEET_SIDE_CLASS[side],
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <P.Close
            data-slot="sheet-close"
            className="absolute top-4 right-4 rounded-sm opacity-70 hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4"
          >
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </P.Close>
        )}
      </P.Content>
    </P.Portal>
  );
}

export const SheetHeader = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div
    data-slot="sheet-header"
    className={cn("flex shrink-0 flex-col gap-1.5", className)}
    {...p}
  />
);
export const SheetBody = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div data-slot="sheet-body" className={cn("min-h-0 flex-1 overflow-y-auto", className)} {...p} />
);
export const SheetFooter = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div data-slot="sheet-footer" className={cn("flex shrink-0 gap-2", className)} {...p} />
);
export const SheetTitle = ({ className, ...p }: React.ComponentProps<typeof P.Title>) => (
  <P.Title data-slot="sheet-title" className={cn("text-lg font-semibold", className)} {...p} />
);
export const SheetDescription = ({
  className,
  ...p
}: React.ComponentProps<typeof P.Description>) => (
  <P.Description
    data-slot="sheet-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...p}
  />
);
