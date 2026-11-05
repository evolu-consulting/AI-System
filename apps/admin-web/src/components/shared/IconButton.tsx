// CR-121 · nút icon dùng chung: không viền, nhãn hiện khi hover/focus (tooltip), luôn có aria-label.
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & {
  /** Nhãn: vừa là aria-label vừa là nội dung tooltip. */
  label: string;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

export const ICON_BUTTON_CLASS =
  "inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none aria-expanded:bg-muted [&_svg]:size-4";

export function IconButton({
  label,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={ref}
          type={type}
          aria-label={label}
          className={cn(ICON_BUTTON_CLASS, className)}
          {...rest}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
