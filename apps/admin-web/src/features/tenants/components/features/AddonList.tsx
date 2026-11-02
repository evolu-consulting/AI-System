// CR-111 · danh sách tính năng thêm (hoặc mọi feature của app dạng danh sách): tên dễ hiểu + mô tả + công tắc.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Switch } from "@/components/ui/switch";
import { featureText } from "@/features/features/lib/feature-label";
import { useTr } from "@/lib/use-translate";
import type { TenantFeature } from "../../lib/feature-assign";

type Props = {
  items: TenantFeature[];
  draft: ReadonlySet<string>;
  /** App đang Tắt: khoá công tắc và hiện gợi ý. */
  locked: boolean;
  showAddonBadge: boolean;
  onToggle: (key: string, on: boolean) => void;
};

export function AddonList({ items, draft, locked, showAddonBadge, onToggle }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  if (items.length === 0) return null;
  return (
    <div className="border-t border-border pt-3">
      {showAddonBadge ? (
        <p className="mb-2 text-label font-medium text-muted-foreground">
          {t("tenants.features.addonsTitle")}
          {locked ? (
            <span className="font-normal"> · {t("tenants.features.addonsLocked")}</span>
          ) : null}
        </p>
      ) : null}
      <ul className="space-y-2">
        {items.map((f) => {
          const text = featureText(tr, i18n.language, { ...f, description: undefined });
          return (
            <li key={f.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-body font-medium">
                  {text.name}
                  {showAddonBadge ? (
                    <StatusBadge tone="warn">{t("features.addon")}</StatusBadge>
                  ) : null}
                </p>
                {text.desc ? (
                  <p className="text-caption text-muted-foreground">{text.desc}</p>
                ) : null}
                <p className="font-mono text-caption text-muted-foreground">{f.key}</p>
              </div>
              <Switch
                aria-label={t("tenants.features.switchAria", { name: text.name })}
                checked={draft.has(f.key)}
                disabled={locked}
                onCheckedChange={(on) => onToggle(f.key, on)}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
