// CR-180 · Khung đầu trang dùng chung. Desktop: tiêu đề trái; nút phụ + nút chính phải.
// Điện thoại (≤ 640px): tiêu đề 1 hàng (cắt «…»), mô tả, nút chính RỘNG HẾT ngay dưới, nút phụ gom vào menu «⋯» cạnh tiêu đề.
// Nút chính chỉ render MỘT lần (đổi chỗ bằng `order`); nút phụ desktop ẩn bằng CSS trên điện thoại (menu «⋯» thế chỗ).
import type { ReactNode } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { ICONS } from "./icons";
import { TruncText } from "./trunc-text";

export type PageHeaderAction = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Lý do khoá (chỉ có nghĩa khi `disabled`): hiện ở tooltip (desktop) và dưới nhãn (menu «⋯»). */
  reason?: string;
};

export type PageHeaderProps = {
  title: string;
  description?: ReactNode;
  /** Nút chính (một `<Button>` primary). Điện thoại: rộng hết hàng, dưới tiêu đề. */
  primary?: ReactNode;
  /** Nút phụ. Desktop: nút `quiet` cạnh nút chính. Điện thoại: mục trong menu «⋯». */
  actions?: PageHeaderAction[];
  /** Nội dung thêm dưới đầu trang (tab, bộ lọc…). */
  children?: ReactNode;
  className?: string;
  /** Nhãn nút «⋯» (a11y). */
  moreLabel?: string;
};

export function PageHeader({
  title,
  description,
  primary,
  actions = [],
  children,
  className,
  moreLabel = "Thêm thao tác",
}: PageHeaderProps) {
  const MoreIcon = ICONS.moreActions;
  return (
    <header data-slot="page-header" className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <div className="min-w-0 flex-1 basis-0">
          <TruncText as="h1" text={title} className="block text-2xl font-bold leading-tight" />
          {description && (
            <p data-slot="page-header-description" className="mt-1 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions.length > 0 && (
          <>
            <div data-slot="page-header-actions" className="flex items-center gap-2 max-sm:hidden">
              {actions.map((a) => (
                <Button
                  key={a.label}
                  variant={a.danger ? "danger" : "quiet"}
                  disabled={a.disabled && !a.reason}
                  {...(a.disabled && a.reason ? { disabledReason: a.reason } : {})}
                  onClick={a.onSelect}
                >
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </div>
            <div data-slot="page-header-more" className="hidden max-sm:block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={moreLabel}>
                    <MoreIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.map((a) => (
                    <DropdownMenuItem
                      key={a.label}
                      danger={a.danger ?? false}
                      disabled={a.disabled ?? false}
                      onSelect={a.onSelect}
                    >
                      {a.icon}
                      <span className="flex min-w-0 flex-col">
                        <span>{a.label}</span>
                        {a.disabled && a.reason && (
                          <span className="text-xs text-muted-foreground">{a.reason}</span>
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </>
        )}
        {primary && (
          <div
            data-slot="page-header-primary"
            className="max-sm:order-last max-sm:w-full max-sm:[&>*]:w-full"
          >
            {primary}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}
