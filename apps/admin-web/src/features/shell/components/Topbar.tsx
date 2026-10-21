// ADM-FR-60 · topbar: nút menu (di động), breadcrumb, badge ("Nền tảng" / tên tenant), menu avatar.

import { fallbackApps } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { AppSwitcher } from "@ai/web-kit/ui/AppSwitcher";
import { TopShell } from "@ai/web-kit/ui/TopShell";
import { Link, useLocation } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FALLBACK_URLS } from "@/lib/apps";
import { session } from "@/lib/auth/session";
import { useSession } from "@/lib/auth/use-session";
import { fetchMyApps, requestSsoGrant } from "../hooks/use-apps";
import { crumbsFor } from "../lib/nav";
import { AccountMenu } from "./AccountMenu";
import { SidebarNav } from "./SidebarNav";

function Breadcrumbs() {
  const { t } = useTranslation();
  const pathname = useLocation({ select: (l) => l.pathname });
  const crumbs = crumbsFor(pathname);
  return (
    <nav aria-label={t("nav.breadcrumb")} className="min-w-0 text-label text-muted-foreground">
      <ol className="flex items-center gap-2">
        {crumbs.map((c, i) => (
          <li key={c.labelKey} className="flex items-center gap-2 truncate">
            {i > 0 ? <span aria-hidden>/</span> : null}
            {c.to ? (
              <Link to={c.to} className="hover:text-foreground">
                {t(c.labelKey)}
              </Link>
            ) : (
              <span className="font-medium text-foreground">{t(c.labelKey)}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const ADMIN_APP_KEY = "admin";

/** app-catalog · switcher dùng chung: danh sách từ `GET /me/apps`, chuyển phiên bằng mã một lần. */
function Apps() {
  const { t, i18n } = useTranslation();
  const me = useSession((s) => s.me);
  return (
    <AppSwitcher
      current={ADMIN_APP_KEY}
      label={t("topbar.apps")}
      locale={i18n.language}
      reloadKey={me?.id}
      fetchApps={fetchMyApps}
      fallback={() => fallbackApps(FALLBACK_URLS, me?.role)}
      handOff={(a, next) =>
        handOffUrl({
          authed: session.getState().status === "authed",
          grant: () => requestSsoGrant(a.key),
          fallbackBase: a.url,
          next,
        })
      }
    />
  );
}

export function Topbar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const role = useSession((s) => s.me?.role);
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  return (
    <TopShell
      start={
        <>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={t("nav.openMenu")}
            onClick={() => setOpen(true)}
          >
            <Menu aria-hidden />
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="left" className="w-sidebar p-0">
              <SheetTitle className="sr-only">{t("nav.main")}</SheetTitle>
              <SheetDescription className="sr-only">{t("nav.main")}</SheetDescription>
              <div className="pt-12">
                <SidebarNav onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Breadcrumbs />
        </>
      }
      apps={<Apps />}
      end={<AccountMenu />}
    >
      {role === "platform_admin" ? (
        <StatusBadge tone="info">{t("topbar.platform")}</StatusBadge>
      ) : (
        <span className="text-label text-muted-foreground">{tenantName}</span>
      )}
    </TopShell>
  );
}
