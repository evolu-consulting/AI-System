// CR-177 · Nhãn trạng thái. Bảng màu cố định; icon bắt buộc để không chỉ dựa vào màu.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-2 py-0.5 text-xs font-semibold [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      status: {
        ok: "bg-success-bg text-success",
        warn: "bg-warning-bg text-warning",
        bad: "bg-danger-bg text-danger",
        info: "bg-accent text-accent-foreground",
        idle: "bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { status: "idle" },
  },
);

export type BadgeStatus = NonNullable<VariantProps<typeof badgeVariants>["status"]>;

export function Badge({
  className,
  status,
  icon,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  status?: BadgeStatus;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      data-slot="badge"
      data-status={status ?? "idle"}
      className={cn(badgeVariants({ status }), className)}
      {...props}
    >
      <span data-slot="badge-icon" aria-hidden="true" className="inline-flex">
        {icon}
      </span>
      {children}
    </span>
  );
}
