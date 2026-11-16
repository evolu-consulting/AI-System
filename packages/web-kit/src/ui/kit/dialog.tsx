// CR-177 U3 · Dialog chung (Radix). Khuôn CR-175: cao ≤ 90vh, Header/Footer cố định, chỉ DialogBody cuộn, Radix khoá cuộn nền, Esc đóng, giữ focus, trả focus về nút mở.
import { XIcon } from "lucide-react";
import { Dialog as P } from "radix-ui";
import type * as React from "react";
import { cn } from "./cn";

export const Dialog = (props: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="dialog" {...props} />
);
export const DialogTrigger = (props: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger data-slot="dialog-trigger" {...props} />
);
export const DialogPortal = (props: React.ComponentProps<typeof P.Portal>) => (
  <P.Portal data-slot="dialog-portal" {...props} />
);
export const DialogClose = (props: React.ComponentProps<typeof P.Close>) => (
  <P.Close data-slot="dialog-close" {...props} />
);

export function DialogOverlay({ className, ...props }: React.ComponentProps<typeof P.Overlay>) {
  return (
    <P.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

export const DIALOG_CONTENT_CLASS =
  "fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg max-sm:max-h-[100dvh] max-sm:rounded-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95";

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  closeLabel = "Đóng",
  ...props
}: React.ComponentProps<typeof P.Content> & { showCloseButton?: boolean; closeLabel?: string }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <P.Content
        data-slot="dialog-content"
        aria-modal="true"
        className={cn(DIALOG_CONTENT_CLASS, className)}
        {...props}
      >
        {children}
        {showCloseButton && (
          <P.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-sm opacity-70 transition-opacity duration-[var(--duration-fast)] hover:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none [&_svg]:size-4"
          >
            <XIcon />
            <span className="sr-only">{closeLabel}</span>
          </P.Close>
        )}
      </P.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-2 text-left", className)}
      {...props}
    />
  );
}

/** Thân cuộn riêng: chỉ phần này cuộn, Header/Footer đứng yên. */
export function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-6 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6", className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof P.Title>) {
  return (
    <P.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof P.Description>) {
  return (
    <P.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
