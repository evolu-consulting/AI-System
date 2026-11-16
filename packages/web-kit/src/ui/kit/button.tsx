// CR-177 · Nút chung. 4 biến thể × cỡ md/sm/icon. Khoá kèm lý do (disabledReason) và đang xử lý (busy).
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps, MouseEvent } from "react";
import { cn } from "./cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-semibold outline-none transition-[transform,background-color,color] duration-[var(--duration-fast)] active:scale-[.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-strong",
        outline: "border-[1.5px] border-primary bg-card text-primary hover:bg-accent",
        quiet: "border border-input bg-card font-medium text-foreground hover:bg-muted",
        danger: "border-[1.5px] border-danger bg-card text-danger hover:bg-danger-bg",
        link: "text-primary underline-offset-4 hover:underline",
        /** Nút chỉ icon trên thanh đầu trang, thanh công cụ, menu thẻ: không viền, không nền. */
        ghost: "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: {
        md: "h-[var(--control-md)] rounded-md px-4 text-md",
        sm: "h-[var(--control-sm)] rounded-sm px-3 text-sm",
        icon: "size-[var(--control-md)] rounded-md text-md",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Common = Omit<ComponentProps<"button">, "disabled"> &
  Pick<VariantProps<typeof buttonVariants>, "variant"> & {
    asChild?: boolean;
    /** Đang xử lý: spinner, chặn bấm, giữ chiều rộng. */
    busy?: boolean;
    /** Khoá kèm lý do: vẫn focus được, chặn bấm, rê/focus hiện lý do. */
    disabledReason?: string;
    disabled?: boolean;
  };
export type ButtonProps =
  | (Common & { size?: "md" | "sm" })
  | (Common & { size: "icon"; "aria-label": string });

export function Button(props: ButtonProps) {
  const {
    className,
    variant,
    size,
    asChild = false,
    busy = false,
    disabledReason,
    onClick,
    children,
    ...rest
  } = props;
  const blocked = Boolean(disabledReason) || busy;
  const Comp = asChild ? Slot.Root : "button";
  const btn = (
    <Comp
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-size={size ?? "md"}
      type={asChild ? undefined : "button"}
      {...rest}
      aria-disabled={blocked ? "true" : undefined}
      aria-busy={busy ? "true" : undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (blocked) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      className={cn(buttonVariants({ variant, size }), className)}
    >
      {asChild || !busy ? (
        children
      ) : (
        <>
          <span className="invisible inline-flex items-center gap-2">{children}</span>
          <Loader2
            data-slot="button-spinner"
            aria-hidden="true"
            className="absolute size-4 animate-spin"
          />
        </>
      )}
    </Comp>
  );
  if (!disabledReason) return btn;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{btn}</TooltipTrigger>
      <TooltipContent>{disabledReason}</TooltipContent>
    </Tooltip>
  );
}
