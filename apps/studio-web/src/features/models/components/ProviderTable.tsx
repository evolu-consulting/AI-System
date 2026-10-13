// HUB-FR-66 · bảng provider (artboard Models): Provider · Loại · Hãng · Trạng thái (chữ) · Slot · Ghi chú · Thao tác.
// [Kiểm tra key]/[Kiểm tra lại]/[Hướng dẫn] gọi `onCheck`/`onGuide` do trang cấp (T5b gắn CheckDialog + Runbook).
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import type { ProviderItem } from "../hooks/use-providers";
import { cooldownMinutes, isReadonlyVendor, needsGuide, statusKey } from "../lib/status";

type Actions = {
  onEdit: (p: ProviderItem) => void;
  onDelete: (p: ProviderItem) => void;
  onCheck?: (p: ProviderItem) => void;
  onGuide?: (p: ProviderItem) => void;
};
const STATUS_VARIANT: Record<string, "ok" | "info" | "warn" | "err" | "off"> = {
  ok: "ok",
  busy: "info",
  cooldown: "warn",
  error: "err",
  logged_out: "warn",
};
const COLS = ["provider", "kind", "vendor", "status", "slots", "notes", "actions"] as const;

function Notes({ p }: { p: ProviderItem }) {
  const { t, i18n } = useTranslation();
  const min = cooldownMinutes(p);
  const time = p.state?.cooldown_until
    ? new Date(p.state.cooldown_until).toLocaleTimeString(i18n.language, { hour12: false })
    : "";
  return (
    <span className="space-x-2">
      {min !== null ? <span>{t("models.provider.cooldownUntil", { min, time })}</span> : null}
      {p.dev_only ? <Badge variant="outline">{t("models.provider.note.dev")}</Badge> : null}
    </span>
  );
}

function Row({ p, ...a }: Actions & { p: ProviderItem }) {
  const { t } = useTranslation();
  const sub = p.kind === "subscription";
  const id = `provider-${p.id}`;
  const btn = (label: string, onClick?: () => void) => (
    <Button variant="outline" size="sm" aria-describedby={id} onClick={onClick}>
      {label}
    </Button>
  );
  return (
    <TableRow>
      <TableCell id={id} className="font-mono">
        {p.key}
      </TableCell>
      <TableCell>{t(sub ? "models.provider.kind.sub" : "models.provider.kind.api")}</TableCell>
      <TableCell>{t(`models.provider.vendor.${p.vendor}`, { defaultValue: p.vendor })}</TableCell>
      <TableCell>
        <Badge variant={STATUS_VARIANT[statusKey(p)] ?? "off"} role="status">
          {t(
            `models.provider.status.${!sub && statusKey(p) === "none" ? "noneApi" : statusKey(p)}`,
          )}
        </Badge>
        {p.enabled ? null : (
          <span className="ml-2 text-muted-foreground">{t("models.provider.disabled")}</span>
        )}
      </TableCell>
      <TableCell>{`${p.slots_in_use}/${p.max_concurrency}`}</TableCell>
      <TableCell>
        <Notes p={p} />
      </TableCell>
      <TableCell className="space-x-2 whitespace-nowrap">
        {btn(t(sub ? "models.provider.action.recheck" : "models.provider.action.check"), () =>
          a.onCheck?.(p),
        )}
        {needsGuide(p) ? btn(t("models.provider.action.guide"), () => a.onGuide?.(p)) : null}
        {isReadonlyVendor(p.vendor) ? (
          <span className="text-label text-muted-foreground">{t("models.provider.managed")}</span>
        ) : (
          <>
            {btn(t("models.provider.action.edit"), () => a.onEdit(p))}
            {btn(t("models.provider.action.delete"), () => a.onDelete(p))}
          </>
        )}
      </TableCell>
    </TableRow>
  );
}

export const ProviderTable = memo(function ProviderTable({
  items,
  ...actions
}: Actions & { items: readonly ProviderItem[] }) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table aria-label={t("models.provider.table.aria")}>
        <TableHeader>
          <TableRow>
            {COLS.map((c) => (
              <TableHead key={c}>
                <span className={c === "actions" ? "sr-only" : undefined}>
                  {t(`models.provider.col.${c}`)}
                </span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((p) => (
            <Row key={p.id} p={p} {...actions} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
});
