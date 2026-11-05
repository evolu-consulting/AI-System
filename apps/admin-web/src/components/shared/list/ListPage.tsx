// CR-121 C-1b · khung trang danh sách "Hướng A": tiêu đề + số đếm, nút hành động chính (có chữ), nút Lọc CHỈ icon mở phễu,
// chip bộ lọc có nút xoá, dòng "n / tổng", vùng bảng (hàng bấm được mở DetailDrawer). Mỗi nhóm lọc là một control duy nhất.
import { Check, Funnel, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEmbedded } from "@/components/shared/embedded";
import { IconButton } from "@/components/shared/IconButton";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { buildChips, type FilterGroup, toggleValue } from "./list-filter";

type Props = {
  title: string;
  description?: string;
  /** Số đếm cạnh tiêu đề (tổng không lọc). */
  count?: number;
  /** Nút hành động chính, có chữ ("Thêm công ty"…). */
  primary?: ReactNode;
  /** Vùng phải khác (bộ chọn công ty…). */
  extra?: ReactNode;
  groups: FilterGroup[];
  onChange: (groupId: string, value: string | undefined) => void;
  onClear: () => void;
  /** Ô tìm (SearchBox) đặt cuối hàng lọc. */
  search?: ReactNode;
  /** "n / tổng"; bỏ trống = không hiện. */
  shown?: number;
  total?: number;
  children: ReactNode;
};

function FunnelMenu({ groups, onChange }: { groups: FilterGroup[]; onChange: Props["onChange"] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton label={t("common.list.filter")} aria-haspopup="menu">
          <Funnel aria-hidden />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 max-w-[80vw] p-1.5">
        <div role="menu" aria-label={t("common.list.filterMenu")}>
          {groups.map((g) => (
            <div key={g.id}>
              <div className="px-2.5 pt-2 pb-0.5 text-caption text-muted-foreground">{g.label}</div>
              {g.options.map((o) => {
                const on = g.value === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={on}
                    onClick={() => onChange(g.id, toggleValue(g.value, o.value))}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-body hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                  >
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.count === undefined ? null : (
                      <span className="text-caption text-muted-foreground">{o.count}</span>
                    )}
                    {on ? <Check aria-hidden className="size-3.5 text-primary" /> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ListPage({
  title,
  description,
  count,
  primary,
  extra,
  groups,
  onChange,
  onClear: _onClear,
  search,
  shown,
  total,
  children,
}: Props) {
  const { t } = useTranslation();
  const embedded = useEmbedded();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!embedded) headingRef.current?.focus({ preventScroll: true });
  }, [embedded]);
  const Heading = embedded ? "h2" : "h1";
  const chips = buildChips(groups);
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <Heading
            ref={headingRef}
            tabIndex={-1}
            className={cn(
              "flex items-baseline gap-2.5 font-semibold tracking-tight text-foreground outline-none",
              embedded ? "text-h3" : "text-page-title",
            )}
          >
            {title}
            {count === undefined ? null : (
              <span aria-hidden className="font-mono text-body font-medium text-muted-foreground">
                {count}
              </span>
            )}
          </Heading>
          {description ? (
            <p className="mt-1 text-body text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {extra}
        {primary}
      </header>
      <section aria-label={t("common.list.filter")} className="flex flex-wrap items-center gap-2">
        {groups.length > 0 ? <FunnelMenu groups={groups} onChange={onChange} /> : null}
        {chips.map((c) => {
          const name = `${c.groupLabel}: ${c.label}`;
          return (
            <span
              key={c.groupId}
              className="inline-flex h-7 items-center gap-1.5 rounded-full bg-accent pr-1 pl-2.5 text-label font-medium text-accent-foreground"
            >
              <span className="font-normal text-muted-foreground">{c.groupLabel}:</span>
              {c.label}
              <button
                type="button"
                aria-label={t("common.list.removeFilter", { name })}
                title={t("common.list.removeFilter", { name })}
                onClick={() => onChange(c.groupId, undefined)}
                className="grid size-5 place-items-center rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <X aria-hidden className="size-3" />
              </button>
            </span>
          );
        })}
        {search ? <div className="ml-auto w-full sm:w-auto">{search}</div> : null}
        {shown !== undefined && total !== undefined ? (
          <span
            className={cn("font-mono text-caption text-muted-foreground", search ? "" : "ml-auto")}
            aria-live="polite"
          >
            {t("common.list.result", { shown, total })}
          </span>
        ) : null}
      </section>
      {children}
    </div>
  );
}

/** Trạng thái rỗng do lọc: "Không có {what} khớp bộ lọc" + Bỏ lọc. */
export function ListEmpty({ what, onClear }: { what: string; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <Funnel aria-hidden className="size-5 text-muted-foreground" />
      <span className="font-medium">{t("common.list.noMatch", { what })}</span>
      <Button type="button" variant="link" onClick={onClear}>
        {t("common.clearFilters")}
      </Button>
    </div>
  );
}
