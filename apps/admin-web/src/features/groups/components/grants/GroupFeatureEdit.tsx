// ADM-FR-32 · M3-R07, R09 · chế độ Sửa tab Feature: ô tick các feature đã entitlement; hàng đã thu hồi entitlement mờ, giữ tick, khoá.
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { pickLocalized } from "@/lib/localized";
import { cn } from "@/lib/utils";
import { type GrantRow, isEditable } from "../../lib/grants";
import { FeatureMeta, FeatureRowInfo } from "./GroupFeatureList";

type Props = {
  rows: GrantRow[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
};

export function GroupFeatureEdit({ rows, selected, onToggle }: Props) {
  const { t, i18n } = useTranslation();
  // core không nhận grant (tự hiệu lực) nên không có ô tick; hàng revoked chỉ hiện khi còn grant.
  const items = rows.filter((r) => isEditable(r) || (r.state === "revoked" && r.granted));
  const core = rows.find((r) => r.state === "core");
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {core ? (
        <li className="flex items-center justify-between gap-3 px-4 py-3">
          <FeatureRowInfo row={core} />
          <span className="text-label text-muted-foreground">{t("groups.features.core")}</span>
        </li>
      ) : null}
      {items.map((r) => {
        const locked = !isEditable(r);
        const id = `grant-${r.id}`;
        return (
          <li
            key={r.id}
            className={cn(
              "flex items-start gap-3 px-4 py-3",
              locked && "bg-muted/40 text-muted-foreground",
            )}
          >
            <Checkbox
              id={id}
              checked={locked ? r.granted : selected.has(r.id)}
              disabled={locked}
              onCheckedChange={(v) => onToggle(r.id, v === true)}
              className="mt-1"
            />
            <div className="min-w-0">
              <Label htmlFor={id} className="font-medium">
                {pickLocalized(r.name, i18n.language)}
              </Label>
              <FeatureMeta row={r} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
