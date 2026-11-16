// ux-excel E1/E4: menu nhỏ dạng nút + danh sách (Xuất ▾, ⋯). CR-177 W1: bên trong là DropdownMenu của kit
// (Enter/↓ mở và đưa con trỏ vào menu, mũi tên, Esc trả focus nút, portal không bị khung thẻ che — CR-166).
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import type { ReactNode } from "react";

export type PopItem = {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Thuộc tính `data-approval` để harness ẩn/nhận (giữ như nút cũ). */
  dataAttr?: string;
  /** CR-128 (e): `data-testid` của mục. */
  testId?: string;
  /** Mục nguy hiểm (Xoá): chữ đỏ, có vạch ngăn phía trên. */
  danger?: boolean;
  /** Vạch ngăn phía trên mục. */
  divider?: boolean;
  /** Lý do khi mục bị khoá (dòng phụ + tooltip). */
  why?: string;
};

/** Vạch ngăn phía trên mục thứ `idx`: chỉ khi mục đòi vạch (divider/danger) VÀ đã có mục phía trước (mục đầu không có vạch). */
export function showDivider(items: Pick<PopItem, "divider" | "danger">[], idx: number): boolean {
  const i = items[idx];
  return idx > 0 && !!i && !!(i.divider || i.danger);
}

export function PopMenu({
  trigger,
  ariaLabel,
  triggerClass,
  items,
  disabled,
  busy,
  triggerTestId,
}: {
  trigger: ReactNode;
  ariaLabel: string;
  triggerClass: string;
  items: PopItem[];
  disabled?: boolean;
  busy?: boolean;
  triggerTestId?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={triggerClass}
          aria-label={ariaLabel}
          aria-busy={busy}
          data-testid={triggerTestId}
          disabled={disabled}
        >
          {trigger}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        collisionPadding={8}
        className="max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[200px] rounded-lg border-rule bg-panel p-0 py-1 text-sm shadow-lg"
      >
        {items.map((i, idx) => (
          <div key={i.key} role="none">
            {showDivider(items, idx) && <DropdownMenuSeparator className="mx-0 my-1 bg-rule" />}
            <DropdownMenuItem
              data-approval={i.dataAttr}
              data-testid={i.testId}
              disabled={i.disabled}
              title={i.why}
              danger={i.danger}
              className={`block w-full rounded-none px-3 py-2 text-left data-[highlighted]:bg-sunk data-[highlighted]:text-ink data-[disabled]:text-dim data-[disabled]:opacity-100 ${
                i.danger ? "text-late data-[highlighted]:bg-sunk data-[highlighted]:text-late" : ""
              }`}
              onSelect={() => i.onSelect()}
            >
              {i.label}
              {i.why && <span className="block text-caption text-dim">{i.why}</span>}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
