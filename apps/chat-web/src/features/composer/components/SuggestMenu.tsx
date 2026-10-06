// HUB-FR-10/91 · listbox gợi ý dưới ô nhập (dùng chung menu `/` và `@`): a11y theo plan-frontend §1.1; ≤ 8 dòng thấy, còn lại cuộn.
import { memo, type ReactNode, useEffect } from "react";
import { cn } from "~/lib/utils";

export type SuggestOption = { id: string; content: ReactNode };

export type SuggestMenuProps = {
  id: string;
  label: string;
  options: readonly SuggestOption[];
  active: number;
  onPick(index: number): void;
  /** Có `notice` (đang tải / rỗng / lỗi / không khớp) thì hiện thay danh sách. */
  notice?: ReactNode;
};

export const optionId = (menuId: string, i: number) => `${menuId}-opt-${i}`;

export const SuggestMenu = memo(function SuggestMenu({
  id,
  label,
  options,
  active,
  onPick,
  notice,
}: SuggestMenuProps) {
  useEffect(() => {
    document.getElementById(optionId(id, active))?.scrollIntoView?.({ block: "nearest" });
  }, [id, active]);
  return (
    <div className="mb-1 overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md">
      {notice !== undefined ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">{notice}</div>
      ) : null}
      <div
        id={id}
        role="listbox"
        aria-label={label}
        hidden={notice !== undefined}
        className="max-h-[calc(8*2.75rem)] overflow-y-auto py-1"
      >
        {options.map((o, i) => (
          <div
            key={o.id}
            id={optionId(id, i)}
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            // mousedown giữ focus ở textarea
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(i);
            }}
            className={cn(
              "cursor-pointer px-3 py-1.5 text-sm",
              i === active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
            )}
          >
            {o.content}
          </div>
        ))}
      </div>
    </div>
  );
});
