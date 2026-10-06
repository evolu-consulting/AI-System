// HUB-FR-72 · H4a-R02 · badge `hub config vN` (từ `me`); mọi lưu thành công invalidate `me` → badge cập nhật.
import { useTranslation } from "react-i18next";
import { useMe } from "../hooks/use-me";

export function ConfigBadge() {
  const { t } = useTranslation();
  const data = useMe();
  if (!data) return null;
  return (
    <span
      role="status"
      aria-label={t("topbar.configBadgeLabel")}
      className="rounded-md bg-muted px-2 py-0.5 font-mono text-label text-muted-foreground"
    >
      {t("topbar.configBadge", { n: data.hub_config_version })}
    </span>
  );
}
