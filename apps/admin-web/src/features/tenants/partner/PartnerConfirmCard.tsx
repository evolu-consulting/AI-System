// CR-125 · UX-S7 (H7) · Quản trị nền tảng › Công ty › Ứng dụng: công tắc "Đối tác xác nhận hợp đồng" + danh sách điều kiện, mỗi dòng có trạng thái,
// lý do, AI làm và nút "Làm bước này" khi nền tảng làm hộ được. Công ty (tenant_admin) chỉ xem. MỘT luật `partnerChecklist` (contracts) cho cả hai nơi.
import type { PartnerFix, PartnerItem } from "@ai/contracts/modules";
import { notifyError } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { describeError } from "@/lib/errors";
import { useTr } from "@/lib/use-translate";
import { usePartnerConfirm, usePartnerFix, useSetPartnerConfirm } from "./partner-api";

type Props = {
  tenantId: string;
  /** platform_admin: có công tắc + nút làm hộ; tenant_admin: chỉ xem. */
  canEdit: boolean;
  /** Chuyển tới màn làm việc (Hồ sơ · Quy trình). */
  onOpen: (tab: "profile" | "processes") => void;
};

const tone = (s: PartnerItem["state"]) => (s === "ok" ? "ok" : s === "todo" ? "warn" : "off");

function ItemRow(p: {
  item: PartnerItem;
  canEdit: boolean;
  busy: boolean;
  onFix: (fix: PartnerFix, item: PartnerItem) => void;
}) {
  const { t } = useTranslation();
  const { item } = p;
  const emptyOnly = item.key === "groups" && item.state === "todo" && !item.params?.groups?.length;
  const text = emptyOnly
    ? t("tenants.partner.emptyGroups", { empty: item.params?.empty?.join(", ") })
    : t(`tenants.partner.item.${item.key}.${item.state}`, {
        groups: item.params?.groups?.join(", "),
      });
  const fix = item.state === "todo" && !emptyOnly ? item.fix : undefined;
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2"
      data-testid={`partner-item-${item.key}`}
      data-state={item.state}
    >
      <StatusBadge tone={tone(item.state)}>{t(`tenants.partner.state.${item.state}`)}</StatusBadge>
      <span className="min-w-0 flex-1 text-body">{text}</span>
      {item.state !== "ok" ? (
        <span className="text-caption text-muted-foreground">
          {t(`tenants.partner.who.${emptyOnly ? "company" : item.who}`)}
        </span>
      ) : null}
      {p.canEdit && fix && item.who === "platform" ? (
        <Button
          size="sm"
          variant="outline"
          disabled={p.busy}
          data-testid={`partner-fix-${fix}`}
          onClick={() => p.onFix(fix, item)}
        >
          {t(`tenants.partner.fix.${fix}`)}
        </Button>
      ) : null}
    </li>
  );
}

/** Một nút "Làm bước này" ⇒ đúng đường có sẵn (cấp tính năng · Tạo nhóm) hoặc chuyển tới màn làm việc. */
async function runFix(
  fix: PartnerFix,
  item: PartnerItem,
  ops: {
    grant: () => Promise<unknown>;
    fixer: ReturnType<typeof usePartnerFix>;
    onOpen: Props["onOpen"];
  },
): Promise<void> {
  if (fix === "grant-feature") await ops.grant();
  else if (fix === "open-profile") ops.onOpen("profile");
  else if (fix === "open-flows") ops.onOpen("processes");
  else
    for (const groupKey of item.params?.groups ?? [])
      await ops.fixer.mutateAsync({ fix: "create-group", groupKey });
}

export function PartnerConfirmCard({ tenantId, canEdit, onOpen }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const q = usePartnerConfirm(tenantId);
  const set = useSetPartnerConfirm(tenantId);
  const fixer = usePartnerFix(tenantId);
  const c = q.data;
  const fail = (e: unknown) => {
    const spec = describeError(e);
    notifyError(tr(spec.key, spec.params));
  };
  if (q.isError) {
    return (
      <Card data-testid="partner-confirm">
        <CardContent className="py-4 text-body text-destructive">
          {t("tenants.partner.loadError")}
        </CardContent>
      </Card>
    );
  }
  if (!c) return null;
  const todo = c.items.filter((i) => i.state !== "ok").length;
  const status = !c.on
    ? t("tenants.partner.status.off")
    : c.ready_to_receive && c.ready_to_send
      ? t("tenants.partner.status.ready")
      : t("tenants.partner.status.missing", { count: todo });
  const doFix = (fix: PartnerFix, item: PartnerItem) =>
    runFix(fix, item, { grant: () => set.mutateAsync(true), fixer, onOpen }).catch(fail);
  return (
    <Card data-testid="partner-confirm" data-on={c.on ? "yes" : "no"}>
      <CardHeader>
        <CardTitle>{t("tenants.partner.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <label htmlFor="partner-confirm-switch" className="text-body font-medium">
              {t("tenants.partner.switch")}
            </label>
            <p className="text-caption text-muted-foreground">{t("tenants.partner.hint")}</p>
            <p className="text-caption font-medium" data-testid="partner-status">
              {status}
            </p>
          </div>
          <Switch
            id="partner-confirm-switch"
            data-testid="partner-confirm-switch"
            checked={c.on}
            disabled={!canEdit || set.isPending}
            onCheckedChange={(on) => void set.mutateAsync(on).catch(fail)}
          />
        </div>
        <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">
          {c.items.map((i) => (
            <ItemRow
              key={i.key}
              item={i}
              canEdit={canEdit}
              busy={set.isPending || fixer.isPending}
              onFix={(fix, item) => void doFix(fix, item)}
            />
          ))}
        </ul>
        {canEdit ? null : (
          <p className="text-caption text-muted-foreground">{t("tenants.partner.askPlatform")}</p>
        )}
      </CardContent>
    </Card>
  );
}
