// CR-187 BR-187-6 · nút chỉ icon (Sửa/Xoá/Ẩn của bình luận): tooltip + aria-label, 28px (điện thoại 44px, xem mobile.css).
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import type { ReactNode } from "react";

export function IconAction({
  label,
  onClick,
  testId,
  children,
}: {
  label: string;
  onClick: () => void;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="iconact"
          aria-label={label}
          data-testid={testId}
          onClick={onClick}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
