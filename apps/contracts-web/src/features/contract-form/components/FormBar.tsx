// V2-F · mockup `.fhead`: thanh đầu form DÍNH trên cùng khi cuộn — tiêu đề + nút "Hủy" / "Lưu" luôn trong tầm tay (không phải cuộn xuống cuối).
import type { ReactNode } from "react";

export function FormBar({
  crumb,
  title,
  lead,
  cancel,
  save,
}: {
  crumb: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  cancel: ReactNode;
  save: ReactNode;
}) {
  return (
    <div
      data-testid="form-bar"
      className="sticky -top-7 z-10 -mx-1 mb-5 -mt-7 flex flex-wrap items-end gap-4 border-b border-rule bg-ground px-1 pt-6 pb-3.5 max-md:-top-4 max-md:-mt-4 max-md:pt-4"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <nav className="text-label text-dim">{crumb}</nav>
        <h1 className="text-[26px] font-semibold tracking-[-0.01em] max-sm:text-[22px]">{title}</h1>
        {lead && <p className="text-sm text-dim">{lead}</p>}
      </div>
      <div className="flex gap-2.5 max-md:w-full max-md:[&>*]:flex-1">
        {cancel}
        {save}
      </div>
    </div>
  );
}
