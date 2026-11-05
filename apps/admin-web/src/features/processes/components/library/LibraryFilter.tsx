// CR-120 · nút phễu của bảng thư viện: popover nhỏ (App · Việc · Trạng thái · Tenant) + chip bộ lọc đang bật (bỏ từng cái). Lọc phía client.
import { Filter, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTr } from "@/lib/use-translate";
import { useAssignableTenants } from "../../hooks/use-assignable-tenants";
import {
  activeCount,
  appOptions,
  type LibFilter,
  type LibStatus,
  slotOptions,
} from "../../lib/library-filter";
import type { LibraryListItem } from "../../library-api";

type Props = {
  filter: LibFilter;
  rows: readonly LibraryListItem[];
  onChange: (f: LibFilter) => void;
};
const ALL = "__all";
const L = "process.admin.library.filter.";

function Field(p: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-label font-medium text-muted-strong-foreground">{p.label}</span>
      {p.children}
    </div>
  );
}

function Pick(p: {
  label: string;
  value: string | undefined;
  options: { value: string; label: string }[];
  allLabel: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <Field label={p.label}>
      <Select value={p.value ?? ALL} onValueChange={(v) => p.onChange(v === ALL ? undefined : v)}>
        <SelectTrigger size="sm" className="w-full" aria-label={p.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{p.allLabel}</SelectItem>
          {p.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/** Đặt một khoá, bỏ khoá rỗng; đổi app ⇒ bỏ khe không thuộc app đó. */
function patch(f: LibFilter, k: keyof LibFilter, v: string | undefined): LibFilter {
  const next: LibFilter = { ...f };
  if (v === undefined) delete next[k];
  else (next as Record<string, string>)[k] = v;
  if (k === "app" && next.slot && v && next.slot.split(".")[0] !== v) delete next.slot;
  return next;
}

export function LibraryFilter({ filter, rows, onChange }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const tenants = useAssignableTenants(open || filter.tenant !== undefined);
  const n = activeCount(filter);
  const appName = (a: string) => tr(`featmeta.app.${a}.name`, { defaultValue: a });
  const slotLabel = (s: string) => slotOptions(rows).find((o) => o.slot === s)?.label ?? s;
  const tenantLabel = (v: string) =>
    v === "none"
      ? t(`${L}tenantNone`)
      : v === "default"
        ? t(`${L}tenantDefault`)
        : t(`${L}tenantOf`, { name: tenants.items.find((x) => x.id === v)?.name ?? "…" });
  const chips: { k: keyof LibFilter; text: string }[] = [
    ...(filter.app ? [{ k: "app" as const, text: appName(filter.app) }] : []),
    ...(filter.slot ? [{ k: "slot" as const, text: slotLabel(filter.slot) }] : []),
    ...(filter.status ? [{ k: "status" as const, text: t(`${L}${filter.status}`) }] : []),
    ...(filter.tenant ? [{ k: "tenant" as const, text: tenantLabel(filter.tenant) }] : []),
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" data-testid="library-filter-button">
            <Filter className="size-4" aria-hidden />
            {n > 0 ? t(`${L}buttonN`, { n }) : t(`${L}button`)}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3" aria-label={t(`${L}title`)}>
          <Pick
            label={t(`${L}app`)}
            value={filter.app}
            allLabel={t(`${L}all`)}
            options={appOptions(rows).map((a) => ({ value: a, label: appName(a) }))}
            onChange={(v) => onChange(patch(filter, "app", v))}
          />
          <Pick
            label={t(`${L}slot`)}
            value={filter.slot}
            allLabel={t(`${L}all`)}
            options={slotOptions(rows, filter.app).map((o) => ({ value: o.slot, label: o.label }))}
            onChange={(v) => onChange(patch(filter, "slot", v))}
          />
          <Pick
            label={t(`${L}status`)}
            value={filter.status}
            allLabel={t(`${L}all`)}
            options={(["draft", "published"] as LibStatus[]).map((s) => ({
              value: s,
              label: t(`${L}${s}`),
            }))}
            onChange={(v) => onChange(patch(filter, "status", v))}
          />
          <Pick
            label={t(`${L}tenant`)}
            value={filter.tenant}
            allLabel={t(`${L}all`)}
            options={[
              { value: "none", label: t(`${L}tenantNone`) },
              { value: "default", label: t(`${L}tenantDefault`) },
              ...tenants.items.map((x) => ({ value: x.id, label: tenantLabel(x.id) })),
            ]}
            onChange={(v) => onChange(patch(filter, "tenant", v))}
          />
        </PopoverContent>
      </Popover>
      {chips.map((c) => (
        <span
          key={c.k}
          className="inline-flex h-8 items-center gap-1 rounded-full border border-primary bg-accent pr-1 pl-3 text-label font-medium text-accent-foreground"
        >
          {c.text}
          <button
            type="button"
            aria-label={t(`${L}remove`, { what: c.text })}
            className="rounded-full p-1 hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => onChange(patch(filter, c.k, undefined))}
          >
            <X className="size-3" aria-hidden />
          </button>
        </span>
      ))}
      {n > 1 ? (
        <Button variant="link" size="sm" className="h-auto p-0" onClick={() => onChange({})}>
          {t(`${L}clear`)}
        </Button>
      ) : null}
    </div>
  );
}
