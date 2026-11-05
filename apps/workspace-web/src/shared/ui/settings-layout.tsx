// CR-120 · MỘT bố cục Cài đặt cho mọi module (Sổ Hợp Tác, Community, …): hộp thoại + menu trái (tab ngang trên mobile) + tiêu đề mục
// kèm mô tả một dòng + hàng "nhãn/mô tả bên trái, ô điều khiển bên phải". Chỉ token của shell. Mỗi mục MỘT kiểu lưu:
// mục dùng bản nháp ⇒ nút Lưu ở đầu hộp thoại (`actions`); mục tự lưu ⇒ `autosave` hiện ghi chú "tự lưu".
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { SegButton } from "~/components/shared/seg-button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

export type SettingsNavItem = {
  id: string;
  label: string;
  /** Một dòng gợi ý dưới nhãn (ẩn trên mobile). */
  hint?: string;
  icon?: LucideIcon;
  /** Chấm "khác mặc định" v.v. */
  badge?: ReactNode;
};
export type SettingsNavGroup = {
  id: string;
  /** Không có nhãn ⇒ không vẽ tiêu đề nhóm. */
  label?: string;
  title?: string;
  items: SettingsNavItem[];
};

/** Khung hộp thoại: đầu (tiêu đề + mô tả + nút bên phải) và thân. */
export function SettingsDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  actions,
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="h-[min(860px,calc(100dvh-2.5rem))] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-[1120px]"
      >
        <header className="flex flex-wrap items-center gap-3 border-b border-rule bg-sunk py-3 pr-14 pl-5">
          <DialogTitle className="text-card-title">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-caption text-dim">{description}</DialogDescription>
          )}
          {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
        </header>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/** Menu trái + vùng nội dung cuộn. */
export function SettingsLayout({
  navLabel,
  groups,
  active,
  onSelect,
  children,
}: {
  navLabel: string;
  groups: SettingsNavGroup[];
  active: string;
  onSelect: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="grid min-h-0 grid-cols-[250px_minmax(0,1fr)] max-md:grid-cols-1 max-md:grid-rows-[auto_minmax(0,1fr)]">
      <nav
        aria-label={navLabel}
        className="flex flex-col gap-3 overflow-y-auto border-r border-rule p-3 max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:border-r-0 max-md:border-b"
      >
        {groups.map((g) => (
          <div
            key={g.id}
            data-testid={`settings-group-${g.id}`}
            className="flex flex-col gap-1 max-md:flex-row"
          >
            {g.label && (
              <b
                data-testid="settings-group-head"
                title={g.title}
                className="px-3 pt-1 text-caption font-semibold text-dim max-md:hidden"
              >
                {g.label}
              </b>
            )}
            {g.items.map((it) => {
              const on = active === it.id;
              const Icon = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  aria-current={on}
                  data-testid={`settings-nav-${it.id}`}
                  onClick={() => onSelect(it.id)}
                  className={cn(
                    "flex w-full items-start gap-2.5 rounded-[10px] border px-3 py-2 text-left max-md:w-auto max-md:whitespace-nowrap",
                    on ? "border-act-line bg-act-soft" : "border-transparent hover:bg-sunk",
                  )}
                >
                  {Icon && (
                    <Icon
                      aria-hidden
                      className={cn("mt-0.5 size-4 shrink-0", on ? "text-act" : "text-dim")}
                    />
                  )}
                  <span className="flex min-w-0 flex-1 flex-col">
                    <b className={cn("text-label", on && "text-act")}>{it.label}</b>
                    {it.hint && (
                      <span className="text-caption font-normal text-dim max-md:hidden">
                        {it.hint}
                      </span>
                    )}
                  </span>
                  {it.badge}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="min-w-0 overflow-y-auto p-5" id="settings-scroll">
        {children}
      </div>
    </div>
  );
}

/** Một mục: tiêu đề + mô tả một dòng; `autosave` ⇒ ghi chú tự lưu. */
export function SettingsSection({
  title,
  description,
  autosaveNote,
  children,
}: {
  title: string;
  description?: string;
  /** Mục tự lưu khi thay đổi ⇒ ghi chú một dòng (mục dùng nút Lưu chung thì bỏ trống). */
  autosaveNote?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="mt-1 text-label text-dim">{description}</p>}
      {autosaveNote && (
        <p className="mt-1 text-caption text-dim" data-testid="settings-autosave-note">
          {autosaveNote}
        </p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Thẻ gom các hàng, tiêu đề phụ tuỳ chọn. */
export function SettingsGroup({
  title,
  sub,
  action,
  children,
}: {
  title?: string;
  sub?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-4 overflow-hidden rounded-xl border border-rule bg-panel">
      {title && (
        <header className="flex items-center gap-3 border-b border-rule-soft bg-sunk px-5 py-3">
          <h3 className="text-label font-semibold">{title}</h3>
          {sub && <span className="text-caption text-dim">{sub}</span>}
          {action && <span className="ml-auto">{action}</span>}
        </header>
      )}
      {children}
    </section>
  );
}

/** Hàng: nhãn + mô tả bên trái, ô điều khiển bên phải. */
export function SettingsRow({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_minmax(0,1.4fr)] items-center gap-4 border-t border-rule-soft px-5 py-3.5 first:border-t-0 max-md:grid-cols-1 max-md:gap-2">
      <div className="flex min-w-0 flex-col">
        <label htmlFor={htmlFor} className="text-label text-ink-2">
          {label}
        </label>
        {hint && <span className="text-caption text-dim">{hint}</span>}
      </div>
      <div className="flex min-w-0 flex-col items-start md:items-end [&>*]:max-w-full">
        {children}
      </div>
    </div>
  );
}

/** Công tắc bật/tắt (một kiểu duy nhất cho mọi cài đặt). */
export function SettingsSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-60",
        checked ? "bg-act" : "bg-field",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-panel transition-transform",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}

/** Chọn một trong vài lựa chọn ngắn (giao diện, ngôn ngữ…). */
export function SettingsSeg<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <span
      role="radiogroup"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-full border border-field bg-panel"
    >
      {options.map(([v, text]) => (
        <SegButton
          key={String(v)}
          checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "px-3.5 py-1.5 text-[12.5px]",
            value === v ? "bg-act-soft font-semibold text-act" : "text-ink-2",
          )}
        >
          {text}
        </SegButton>
      ))}
    </span>
  );
}
