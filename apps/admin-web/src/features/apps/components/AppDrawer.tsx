// CR-121 C-1b · ngăn tóm tắt một Ứng dụng (mở khi bấm hàng); chi tiết đầy đủ ở trang /apps/$appKey.
import type { AppCatalogItem } from "@ai/contracts/app-catalog";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";

type Props = { app: AppCatalogItem | null; onClose: () => void };

export function AppDrawer({ app: a, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <DetailDrawer
      open={!!a}
      onClose={onClose}
      kind={t("apps.drawer.kind")}
      title={a?.name.vi ?? ""}
      status={
        a
          ? { label: a.enabled ? t("common.on") : t("common.off"), tone: a.enabled ? "ok" : "off" }
          : undefined
      }
      facts={
        a
          ? [
              { k: t("apps.col.key"), v: <span className="font-mono">{a.key}</span> },
              { k: t("apps.col.url"), v: a.url || "—" },
              { k: t("apps.col.audience"), v: t(`apps.audience.${a.audience}`) },
              {
                k: t("apps.col.feature"),
                v: <span className="font-mono">{a.required_feature ?? "—"}</span>,
              },
              { k: t("apps.col.sort"), v: a.sort_order },
            ]
          : []
      }
      detail={
        a ? (
          <Link
            to="/apps/$appKey"
            params={{ appKey: a.key }}
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            {t("common.list.openDetail")}
          </Link>
        ) : null
      }
    />
  );
}
