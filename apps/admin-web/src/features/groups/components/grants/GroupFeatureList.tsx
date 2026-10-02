// ADM-FR-32 · M3-R09 · chế độ xem tab Feature: core ("Mọi người đều có", không sửa) + feature đang được cấp (kể cả đã thu hồi entitlement).
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { pickLocalized } from "@/lib/localized";
import { type GrantRow, viewRows } from "../../lib/grants";

const TONE = { on: "ok", beta: "info", off: "off" } as const;

/** Nhãn "Đã thu hồi entitlement" + danh sách command (mono) dưới tên feature. */
export function FeatureMeta({ row }: { row: GrantRow }) {
  const { t } = useTranslation();
  const commands = row.commandNames.map((n) => `/${n}`).join(", ");
  return (
    <>
      {row.state === "revoked" ? (
        <StatusBadge tone="warn">{t("access.matrix.revoked")}</StatusBadge>
      ) : null}
      {commands ? <p className="font-mono text-label text-muted-foreground">{commands}</p> : null}
    </>
  );
}

export function FeatureRowInfo({ row }: { row: GrantRow }) {
  const { i18n } = useTranslation();
  return (
    <div className="min-w-0">
      <span className="font-medium">{pickLocalized(row.name, i18n.language)}</span>{" "}
      <FeatureMeta row={row} />
    </div>
  );
}

export function GroupFeatureList({ rows }: { rows: GrantRow[] }) {
  const { t } = useTranslation();
  const shown = viewRows(rows);
  const granted = shown.filter((r) => r.state !== "core");
  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
      {shown.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <FeatureRowInfo row={r} />
          {r.state === "core" ? (
            <span className="text-label text-muted-foreground">{t("groups.features.core")}</span>
          ) : (
            <StatusBadge tone={TONE[r.status]}>{t(`features.status.${r.status}`)}</StatusBadge>
          )}
        </li>
      ))}
      {granted.length === 0 ? (
        <li className="px-4 py-3 text-body text-muted-foreground">{t("groups.features.empty")}</li>
      ) : null}
    </ul>
  );
}
