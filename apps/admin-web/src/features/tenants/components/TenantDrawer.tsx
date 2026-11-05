// CR-121 C-3c · ngăn tóm tắt một công ty (mở khi bấm hàng); chi tiết đầy đủ ở trang /tenants/$tenantId (tab Hồ sơ).
// Ứng dụng đang bật nạp theo công ty đang mở (một lần), không đổi API danh sách.
import type { Tenant } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DetailDrawer } from "@/components/shared/list/DetailDrawer";
import { useTr } from "@/lib/use-translate";
import { useTenantFeatureStates } from "../api";
import { buildCards, entitledKeys } from "../lib/feature-assign";
import { type AppOn, appsOn } from "../lib/overview";

type Props = { tenant: Tenant | null; onClose: () => void };

function appsLine(
  apps: AppOn[] | undefined,
  failed: boolean,
  t: (k: string) => string,
  tr: (k: string) => string,
): string {
  if (failed) return "—";
  if (!apps) return t("common.loading");
  if (apps.length === 0) return t("tenants.drawer.noApps");
  return apps.map((a) => tr(`featmeta.app.${a.app}.name`)).join(", ");
}

export function TenantDrawer({ tenant: row, onClose }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const states = useTenantFeatureStates(row?.id ?? "", !!row);
  const apps = useMemo(
    () => (states.data ? appsOn(buildCards(states.data), entitledKeys(states.data)) : undefined),
    [states.data],
  );
  const appsText = appsLine(apps, states.isError, t, tr);
  const locked = row?.status === "locked";
  return (
    <DetailDrawer
      open={!!row}
      onClose={onClose}
      kind={t("tenants.drawer.kind")}
      title={row?.name ?? ""}
      status={
        row
          ? {
              label: t(locked ? "tenants.status.locked" : "tenants.status.active"),
              tone: locked ? "err" : "ok",
            }
          : undefined
      }
      facts={
        row
          ? [
              { k: t("tenants.col.key"), v: <span className="font-mono">{row.key}</span> },
              { k: t("tenants.col.users"), v: row.user_count },
              {
                k: t("tenants.drawer.apps"),
                v: appsText,
              },
            ]
          : []
      }
      detail={
        row ? (
          <Link
            to="/tenants/$tenantId"
            params={{ tenantId: row.id }}
            search={{ tab: "profile" }}
            className="inline-flex items-center gap-1.5 hover:underline"
          >
            {t("common.list.openDetail")}
          </Link>
        ) : null
      }
    />
  );
}
