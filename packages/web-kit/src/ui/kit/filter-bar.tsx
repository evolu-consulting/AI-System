// CR-180 · Khung bộ lọc dùng chung. `chips` = hàng chip nhanh (ToggleGroup/tab); `advanced` = bộ lọc nâng cao.
// Desktop: chip + nâng cao cùng hiện như cũ. Điện thoại (≤ 640px): chip 1 hàng cuộn ngang (mờ mép phải khi tràn),
// nâng cao vào nút «Lọc» mở Sheet từ dưới lên (nút ghi số bộ lọc đang bật `activeCount`).
import { type ReactNode, useState } from "react";
import { Button } from "./button";
import { cn } from "./cn";
import { ICONS } from "./icons";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "./sheet";

export type FilterBarProps = {
  chips?: ReactNode;
  advanced?: ReactNode;
  /** Số bộ lọc nâng cao đang bật (hiện trên nút «Lọc»). */
  activeCount?: number;
  /** Nhãn nút + tiêu đề Sheet (mặc định «Lọc»). */
  filterLabel?: string;
  /** Nhãn nút đóng Sheet (mặc định «Xong»). */
  doneLabel?: string;
  className?: string;
};

/** Hàng chip: desktop tự xuống hàng; điện thoại 1 hàng, cuộn ngang, mờ mép phải. */
export const CHIP_ROW_CLASS =
  "flex min-w-0 flex-wrap items-center gap-2 max-sm:flex-1 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:[scrollbar-width:none] max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] max-sm:[&>*]:shrink-0";

export function FilterBar({
  chips,
  advanced,
  activeCount = 0,
  filterLabel = "Lọc",
  doneLabel = "Xong",
  className,
}: FilterBarProps) {
  const [open, setOpen] = useState(false);
  const FilterIcon = ICONS.filter;
  return (
    <div
      data-slot="filter-bar"
      className={cn("flex flex-wrap items-center gap-2 max-sm:flex-nowrap", className)}
    >
      {chips && (
        <div data-slot="filter-chips" className={CHIP_ROW_CLASS}>
          {chips}
        </div>
      )}
      {advanced && (
        <>
          <div
            data-slot="filter-advanced"
            className="flex flex-wrap items-center gap-2 max-sm:hidden"
          >
            {advanced}
          </div>
          <div data-slot="filter-open" className="hidden shrink-0 max-sm:block">
            <Button variant="quiet" onClick={() => setOpen(true)}>
              <FilterIcon className="size-4" />
              {filterLabel}
              {activeCount > 0 && (
                <span className="tnum text-micro font-bold">({activeCount})</span>
              )}
            </Button>
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetContent side="bottom">
                <SheetHeader>
                  <SheetTitle>{filterLabel}</SheetTitle>
                  <SheetDescription className="sr-only">{filterLabel}</SheetDescription>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-3">{advanced}</SheetBody>
                <SheetFooter>
                  <Button onClick={() => setOpen(false)}>{doneLabel}</Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          </div>
        </>
      )}
    </div>
  );
}
