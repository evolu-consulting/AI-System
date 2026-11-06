// CR-121 C-1b · ngăn tóm tắt một Feature (mở khi bấm hàng); chi tiết đầy đủ ở trang /features/$featureId.
import type { FeatureListItem } from "@ai/contracts/features";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import type { StatusTone } from "@/components/shared/StatusBadge";
import { useTr } from "@/lib/use-translate";
import { featureText } from "../lib/feature-label";

const TONE: Record<FeatureListItem["status"], StatusTone> = { on: "ok", beta: "info", off: "off" };

type Props = { feature: FeatureListItem | null; onClose: () => void };

export function FeatureDrawer({ feature: f, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const text = f ? featureText(tr, i18n.language, f) : null;
  return (
    <DetailDrawer
      open={!!f}
      onClose={onClose}
      kind={t("features.drawer.kind")}
      title={text?.name ?? ""}
      status={f ? { label: t(`features.status.${f.status}`), tone: TONE[f.status] } : undefined}
      line={text?.desc}
      facts={
        f
          ? [
              { k: t("features.drawer.app"), v: tr(`featmeta.app.${f.app}.name`) },
              {
                k: t("features.drawer.usage"),
                v: f.is_core
                  ? t("features.allTenants")
                  : t("features.usage", { commands: f.command_count, tenants: f.tenant_count }),
              },
              { k: t("features.drawer.key"), v: <span className="font-mono">{f.key}</span> },
            ]
          : []
      }
      detail={
        f ? (
          <Link
            to="/features/$featureId"
            params={{ featureId: f.id }}
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            {t("common.list.openDetail")}
          </Link>
        ) : null
      }
    />
  );
}
