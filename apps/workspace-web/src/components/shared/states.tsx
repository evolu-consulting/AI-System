// PK-FR-10 · TF2 · trạng thái rỗng / đang tải / lỗi + Chips. Nguồn: reference/mgmt-app-contracts/web/src/components/ui.tsx:61-121 (viết lại bằng token Tailwind).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "~/lib/utils";

/** Nhóm nút lọc (aria-pressed): bật = nền act-soft, chữ act. */
export function Chips<T extends string>({
  items,
  value,
  onChange,
  extra,
  label,
}: {
  items: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  extra?: ReactNode;
  label: string;
}) {
  return (
    <fieldset aria-label={label} className="m-0 mb-4 flex min-w-0 flex-wrap gap-2 border-0 p-0">
      {items.map((i) => (
        <button
          key={i.id}
          type="button"
          aria-pressed={value === i.id}
          onClick={() => onChange(i.id)}
          className={cn(
            "inline-flex h-9 items-center gap-1 rounded-full border px-3.5 text-label whitespace-nowrap",
            "focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
            value === i.id
              ? "border-transparent bg-act-soft font-semibold text-act"
              : "border-field bg-panel text-ink hover:bg-sunk",
          )}
        >
          {i.label}
        </button>
      ))}
      {extra}
    </fieldset>
  );
}

/** Không có gì để hiện (chưa có dữ liệu / tìm không ra). Mặc định biểu tượng kính lúp; `icon` để đổi. */
export function Empty({
  title,
  children,
  icon,
}: {
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span
        aria-hidden
        className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-sunk text-dim"
      >
        {icon ?? (
          // biome-ignore lint/a11y/noSvgWithoutTitle: trang trí, bọc trong span aria-hidden
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        )}
      </span>
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-dim">{children}</div>}
    </div>
  );
}

/** Vòng quay (currentColor); giảm chuyển động thì globals.css tắt animation, còn lại vòng tĩnh. */
export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t("contracts.common.loading")}
      className="flex justify-center px-6 py-10 text-act"
    >
      <Spinner />
    </div>
  );
}

export function ErrorLine({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="px-6 py-4 text-sm text-late">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
