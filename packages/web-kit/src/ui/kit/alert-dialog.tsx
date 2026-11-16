// CR-177 U3 · AlertDialog (xác nhận mất dữ liệu). Biến thể `danger`: con trỏ mặc định vào nút huỷ («Giữ lại»), không vào nút xoá.
import { AlertDialog as P } from "radix-ui";
import * as React from "react";
import { cn } from "./cn";
import { DIALOG_CONTENT_CLASS } from "./dialog";

export const AlertDialog = (props: React.ComponentProps<typeof P.Root>) => (
  <P.Root data-slot="alert-dialog" {...props} />
);
export const AlertDialogTrigger = (props: React.ComponentProps<typeof P.Trigger>) => (
  <P.Trigger data-slot="alert-dialog-trigger" {...props} />
);

const CancelCtx = React.createContext<{ current: HTMLButtonElement | null } | null>(null);

/** `danger` ⇒ chặn focus mặc định của Radix và đưa vào nút huỷ. */
export function pickCancelFocus(
  danger: boolean,
  cancel: { focus: () => void } | null,
  e: { preventDefault: () => void },
): void {
  if (!danger || !cancel) return;
  e.preventDefault();
  cancel.focus();
}

export function AlertDialogContent({
  className,
  variant = "default",
  onOpenAutoFocus,
  ...props
}: React.ComponentProps<typeof P.Content> & { variant?: "default" | "danger" }) {
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  return (
    <CancelCtx.Provider value={cancelRef}>
      <P.Portal>
        <P.Overlay
          data-slot="alert-dialog-overlay"
          className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        />
        <P.Content
          data-slot="alert-dialog-content"
          data-variant={variant}
          aria-modal="true"
          onOpenAutoFocus={(e) => {
            onOpenAutoFocus?.(e);
            pickCancelFocus(variant === "danger", cancelRef.current, e);
          }}
          className={cn(DIALOG_CONTENT_CLASS, className)}
          {...props}
        />
      </P.Portal>
    </CancelCtx.Provider>
  );
}

export const AlertDialogHeader = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div
    data-slot="alert-dialog-header"
    className={cn("flex flex-col gap-2 text-left", className)}
    {...p}
  />
);
export const AlertDialogFooter = ({ className, ...p }: React.ComponentProps<"div">) => (
  <div
    data-slot="alert-dialog-footer"
    className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
    {...p}
  />
);
export const AlertDialogTitle = ({ className, ...p }: React.ComponentProps<typeof P.Title>) => (
  <P.Title
    data-slot="alert-dialog-title"
    className={cn("text-lg font-semibold", className)}
    {...p}
  />
);
export const AlertDialogDescription = ({
  className,
  ...p
}: React.ComponentProps<typeof P.Description>) => (
  <P.Description
    data-slot="alert-dialog-description"
    className={cn("text-sm text-muted-foreground", className)}
    {...p}
  />
);
export const AlertDialogAction = (p: React.ComponentProps<typeof P.Action>) => (
  <P.Action data-slot="alert-dialog-action" {...p} />
);

/** Nút huỷ («Giữ lại»/Huỷ): nhận focus đầu tiên khi hộp là `danger`. */
export function AlertDialogCancel({ ref, ...p }: React.ComponentProps<typeof P.Cancel>) {
  const ctx = React.useContext(CancelCtx);
  return (
    <P.Cancel
      data-slot="alert-dialog-cancel"
      ref={(el) => {
        if (ctx) ctx.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as { current: HTMLButtonElement | null }).current = el;
      }}
      {...p}
    />
  );
}
