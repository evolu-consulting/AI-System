// V2-F · mockup `.fhead`: thanh đầu form DÍNH trên cùng khi cuộn — tiêu đề + nút "Hủy" / "Lưu" luôn trong tầm tay (không phải cuộn xuống cuối).
// CR-128 L1: tiêu đề (trái) và nút (phải) CÙNG MỘT HÀNG (hẹp thì nút xuống dòng); dòng thông tin full-width bên dưới. `sticky={false}` ⇒ cùng khuôn nhưng không dính (trang HĐ đã gửi).
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export function FormBar({
  crumb,
  title,
  lead,
  cancel,
  save,
  sticky = true,
  accent = false,
  flush = false,
}: {
  crumb: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  /** Nhóm nút phụ (trái của cụm nút). */
  cancel: ReactNode;
  /** Nhóm nút chính (phải). */
  save: ReactNode;
  sticky?: boolean;
  /** CR-135 Q2: thanh dính nền nhấn (accent nhạt + viền) cho nổi khỏi nội dung. */
  accent?: boolean;
  /** CR-193: đầu trang thẳng mép với lưới bên dưới (không margin âm); dính ở mép trên vùng cuộn. */
  flush?: boolean;
}) {
  return (
    <div
      data-testid={sticky ? "form-bar" : "page-head"}
      className={cn(
        "mb-5 flex flex-col gap-1",
        sticky &&
          flush &&
          "sticky top-0 z-10 rounded-[10px] border border-rule bg-ground px-4 py-3",
        sticky &&
          !flush &&
          "sticky -top-7 z-10 -mx-1 -mt-7 border-b border-rule bg-ground px-1 pt-6 pb-3.5 max-md:-top-4 max-md:-mt-4 max-md:pt-4",
        sticky && accent && flush && "border-act/30 bg-act-soft",
        sticky && accent && !flush && "rounded-b-lg border border-act/30 bg-act-soft px-4",
      )}
    >
      <nav className="text-label text-dim">{crumb}</nav>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 flex-[1_1_14rem] text-[26px] leading-tight font-semibold tracking-[-0.01em] max-sm:text-[22px]">
          {title}
        </h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-4 gap-y-2 max-sm:ml-0 max-sm:w-full">
          {cancel ? <div className="flex flex-wrap items-center gap-2">{cancel}</div> : null}
          <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:flex-nowrap max-sm:[&>[data-testid^=act-]]:min-w-0 max-sm:[&>[data-testid^=act-]]:flex-1 max-sm:[&>[data-testid=confirm-save]]:flex-1">
            {save}
          </div>
        </div>
      </div>
      {lead && <div className="text-sm text-dim">{lead}</div>}
    </div>
  );
}
