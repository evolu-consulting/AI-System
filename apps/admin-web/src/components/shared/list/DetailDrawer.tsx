// CR-121 C-1b · ngăn trượt phải: đóng bằng IconButton / Esc / bấm nền (Radix Dialog: focus trap, trả focus). Rộng ≤ 420px, không tràn ở 375px.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/shared/IconButton";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";

export type DrawerFact = { k: string; v: ReactNode };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Loại đối tượng ("Ứng dụng", "Lệnh"…). */
  kind: string;
  title: string;
  status?: { label: string; tone: StatusTone };
  /** Một dòng tóm tắt dưới tiêu đề. */
  line?: ReactNode;
  facts?: DrawerFact[];
  /** Khối thêm (danh sách liên quan…). */
  children?: ReactNode;
  /** Liên kết "Mở trang chi tiết" (đã bọc `<Link>`); bỏ trống nếu không có trang chi tiết. */
  detail?: ReactNode;
  /** Thanh hành động dính đáy ngăn (nội dung cuộn phía trên), vd nút "Xong". */
  footer?: ReactNode;
};

export function DetailDrawer({
  open,
  onClose,
  kind,
  title,
  status,
  line,
  facts,
  children,
  detail,
  footer,
}: Props) {
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        showCloseButton={false}
        // Không tự focus nút Đóng: tooltip của nó mở theo focus và là lớp trên cùng ⇒ Esc đầu tiên chỉ tắt tooltip (cần Esc lần 2 mới đóng ngăn).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.target as HTMLElement | null)?.focus();
        }}
        className="w-full max-w-full gap-0 overflow-y-auto bg-card p-0 sm:max-w-[420px]"
      >
        <div className="flex min-h-full min-w-0 flex-col">
          <div className="flex min-w-0 flex-col gap-5 px-5 pt-4 pb-6">
            <div className="flex items-center gap-2">
              <span className="text-label text-muted-foreground">{kind}</span>
              <SheetClose asChild>
                <IconButton label={t("common.list.closeDrawer")} className="ml-auto">
                  <svg
                    aria-hidden
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </IconButton>
              </SheetClose>
            </div>
            <div className="min-w-0">
              <SheetTitle className="text-h3 font-semibold break-words">{title}</SheetTitle>
              <SheetDescription asChild>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-body text-muted-foreground">
                  {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
                  {line}
                </div>
              </SheetDescription>
            </div>
            {facts && facts.length > 0 ? (
              <dl className="m-0 flex flex-col gap-2">
                {facts.map((f) => (
                  <div key={f.k} className="flex min-w-0 flex-wrap gap-x-3 text-body">
                    <dt className="w-28 shrink-0 text-muted-foreground">{f.k}</dt>
                    <dd className="m-0 min-w-0 flex-1 break-words">{f.v}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {children}
            {detail ? (
              <div className="pt-1 text-label font-medium text-primary">{detail}</div>
            ) : null}
          </div>
          {footer ? (
            <div className="sticky bottom-0 z-10 mt-auto flex justify-end gap-2 border-t border-border bg-card px-5 py-3">
              {footer}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
