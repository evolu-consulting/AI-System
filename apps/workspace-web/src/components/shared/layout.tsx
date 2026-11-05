// PK-FR-10 · TF2 · khung trang dùng chung: PageHead, Panel, Stat. Nguồn: reference/mgmt-app-contracts/web/src/components/ui.tsx:37-59,143-151 (viết lại bằng token Tailwind).
import { createContext, type ReactNode, useContext } from "react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

/** nav-v2: trang nằm trong tab của trang khác (Sản phẩm & Giá) — trang chủ đã có H1 nên tiêu đề con không là H1 và bỏ tiêu đề chỉ-điện-thoại. */
export const EmbeddedHeads = createContext(false);
export const useEmbedded = (): boolean => useContext(EmbeddedHeads);

/** Hàng tiêu đề trong trang. Trang danh sách truyền `titleMobileOnly` để H1 chỉ hiện ở điện thoại (desktop đã có tiêu đề ở thanh trên). */
export function PageHead({
  title,
  lead,
  crumb,
  actions,
  titleMobileOnly,
}: {
  title?: ReactNode;
  lead?: ReactNode;
  crumb?: ReactNode;
  actions?: ReactNode;
  titleMobileOnly?: boolean;
}) {
  const { t } = useTranslation();
  const embedded = useEmbedded();
  return (
    <div className="mb-5 flex flex-wrap items-end gap-4">
      {(crumb || title || lead) && (
        <div className="flex min-w-0 flex-col gap-1">
          {crumb && (
            <nav aria-label={t("contracts.common.breadcrumb")} className="text-label text-dim">
              {crumb}
            </nav>
          )}
          {title && !embedded && (
            <h1
              className={cn(
                "text-[26px] font-semibold tracking-[-0.01em] max-sm:text-[22px]",
                titleMobileOnly && "md:hidden",
              )}
            >
              {title}
            </h1>
          )}
          {title && embedded && <div className="text-[15px] font-medium">{title}</div>}
          {lead && <p className="text-sm text-dim">{lead}</p>}
        </div>
      )}
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-rule bg-panel", className)}>
      {children}
    </section>
  );
}

const STAT_TONE = {
  soon: "border-soon-line bg-soon-bg text-soon",
  late: "border-late-line bg-late-bg text-late",
} as const;

/** Ô số liệu: giá trị lớn + nhãn; `tone` tô khung khi cần chú ý. */
export function Stat({
  value,
  label,
  tone,
  loading,
}: {
  value: ReactNode;
  label: string;
  tone?: keyof typeof STAT_TONE;
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3.5",
        tone ? STAT_TONE[tone] : "border-rule bg-panel",
      )}
    >
      <p className="text-[24px] leading-[1.1] font-medium tabular-nums">
        {loading ? <Skeleton className="my-1 h-6 w-14" /> : value}
      </p>
      <p className={cn("text-label", !tone && "text-dim")}>{label}</p>
    </div>
  );
}
