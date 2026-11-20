// PK-FR-10 · TF2 · shadcn Dialog (chép từ apps/admin-web/src/components/ui/dialog.tsx, bỏ phụ thuộc alias `@/`, nhãn đóng qua `contracts.common.close`).
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

const Dialog = DialogPrimitive.Root;

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    />
  );
}

// CR-175: hộp cao tối đa ~90vh (màn nhỏ ~100dvh), cột flex: Header + Footer cố định, `DialogBody` là phần DUY NHẤT cuộn.
// Nội dung không bọc Body vẫn dùng được: Content tự cuộn (overflow-y-auto). Radix Modal đã khoá cuộn nền — đừng override `overflow` của body.
function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  const { t } = useTranslation();
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 flex max-h-[90vh] w-full flex-col overflow-y-auto max-sm:max-h-[100dvh] max-sm:rounded-none max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-xl border bg-card px-6 pt-5 pb-6 max-sm:px-4 shadow-dialog duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-[520px]",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close className="absolute top-2.5 right-2.5 max-sm:right-1.5 inline-flex size-11 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&_svg]:size-4">
            <XIcon aria-hidden />
            <span className="sr-only">{t("contracts.common.close")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex shrink-0 flex-col gap-2 text-left", className)}
      {...props}
    />
  );
}

/** Thân cuộn riêng (CR-175): chỉ phần này cuộn, Header/Footer đứng yên. `-mx-6 px-6` để thanh cuộn nằm sát mép hộp. */
function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-body"
      className={cn("-mx-6 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 max-sm:-mx-4 max-sm:px-4", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn("flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-dialog-title leading-6 font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-ink-2", className)}
      {...props}
    />
  );
}

export { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle };
