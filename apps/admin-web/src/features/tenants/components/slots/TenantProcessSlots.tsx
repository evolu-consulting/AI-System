// CR-105 · L3: khối "Gán quy trình" ở tab Gói của trang tenant — mỗi khe app đang chạy quy trình nào (hoặc mặc định) + đổi gán.
// 1 tenant × 1 khe = đúng 1 quy trình: gán mới thay bản cũ; "Về mặc định" bỏ gán. Chỉ platform_admin.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TenantSlotInfo } from "@/features/processes/library-api";
import { useTenantSlotBlock } from "../../hooks/use-tenant-slots";

type Block = ReturnType<typeof useTenantSlotBlock>;

function SlotRow({ row, b }: { row: TenantSlotInfo; b: Block }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState("");
  const options = b.candidates(row.slot);
  const busy = b.pending === row.slot;
  const picked = options.find((o) => o.id === choice);
  return (
    <li
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`tenant-slot-${row.slot}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-label font-medium">{row.label}</span>
        <span className="text-body">
          {row.def_name ?? "—"}
          {row.rel_version != null ? ` · v${row.rel_version}` : ""}
        </span>
        <StatusBadge tone={row.is_default ? "off" : "ok"}>
          {row.is_default ? t("tenants.slots.isDefault") : t("tenants.slots.assigned")}
        </StatusBadge>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={choice} onValueChange={setChoice} disabled={busy}>
          <SelectTrigger className="w-72" aria-label={t("tenants.slots.pick")}>
            <SelectValue placeholder={t("tenants.slots.pickPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={busy || !picked}
          onClick={() => picked && void b.assign(row.slot, picked.id, picked.label)}
        >
          {t("tenants.slots.assign")}
        </Button>
        {row.is_default ? null : (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void b.unassign(row.slot)}
          >
            {t("tenants.slots.unassign")}
          </Button>
        )}
      </div>
    </li>
  );
}

export function TenantProcessSlots({ tenant }: { tenant: { id: string; name: string } }) {
  const { t } = useTranslation();
  const b = useTenantSlotBlock(tenant);
  if (b.hidden) return null;
  const rows = b.slots.data ?? [];
  return (
    <section className="space-y-3" aria-label={t("tenants.slots.title")}>
      <div>
        <h2 className="text-h3 font-semibold">{t("tenants.slots.title")}</h2>
        <p className="text-caption text-muted-foreground">{t("tenants.slots.desc")}</p>
      </div>
      {b.slots.isError ? (
        <p role="alert" className="text-body text-destructive">
          {t("tenants.slots.loadFail")}
        </p>
      ) : rows.length === 0 && !b.slots.isPending ? (
        <p className="text-body text-muted-foreground">{t("tenants.slots.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <SlotRow key={r.slot} row={r} b={b} />
          ))}
        </ul>
      )}
    </section>
  );
}
