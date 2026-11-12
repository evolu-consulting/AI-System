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
}) {
  return (
    <div
      data-testid={sticky ? "form-bar" : "page-head"}
      className={cn(
        "mb-5 flex flex-col gap-1",
        sticky &&
          "sticky -top-7 z-10 -mx-1 -mt-7 border-b border-rule bg-ground px-1 pt-6 pb-3.5 max-md:-top-4 max-md:-mt-4 max-md:pt-4",
        sticky && accent && "rounded-b-lg border border-act/30 bg-act-soft px-4",
      )}
    >
      <nav className="text-label text-dim">{crumb}</nav>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="min-w-0 flex-[1_1_20rem] text-[26px] font-semibold tracking-[-0.01em] max-sm:text-[22px]">
          {title}
        </h1>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-2.5">{cancel}</div>
          <div className="flex flex-wrap items-center gap-2.5">{save}</div>
        </div>
      </div>
      {lead && <p className="text-sm text-dim">{lead}</p>}
    </div>
  );
}
