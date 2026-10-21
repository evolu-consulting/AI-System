// HUB-FR-72 · topbar 60px dùng khung chung `TopShell` (web-kit): badge `hub config vN`, switcher "Ứng dụng" dùng chung (danh sách từ
// `GET /auth/me/apps`, Admin quản lý), menu Tài khoản (chỉ khi có phiên).
import { fallbackApps } from "@ai/web-kit/app-catalog/apps";
import { handOffUrl } from "@ai/web-kit/auth/sso";
import { splitHref } from "@ai/web-kit/notify/href";
import { AppSwitcher } from "@ai/web-kit/ui/AppSwitcher";
import { FeedbackButton } from "@ai/web-kit/ui/FeedbackButton";
import { NotificationBell } from "@ai/web-kit/ui/NotificationBell";
import { TopShell } from "@ai/web-kit/ui/TopShell";
import { useNavigate } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "#/components/ui/sheet";
import { FALLBACK_URLS } from "#/lib/apps";
import { session } from "#/lib/auth/session";
import { useSession } from "#/lib/auth/use-session";
import { api } from "#/lib/http";
import { fetchMyApps, requestSsoGrant } from "../hooks/use-apps";
import { ConfigBadge } from "./ConfigBadge";
import { SidebarNav } from "./SidebarNav";
import { UserMenu } from "./UserMenu";

const STUDIO_APP_KEY = "studio";

function Apps() {
  const { t, i18n } = useTranslation();
  const me = useSession((s) => s.user);
  return (
    <AppSwitcher
      current={STUDIO_APP_KEY}
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

/** Client HTTP riêng của studio-web (kit không biết token của web này). Dưới base `/studio`: API `/notifications` ở gốc origin. */
const KIT_TRANSPORT = { request: api };

/** TD #81: dưới `lg` sidebar ẩn ⇒ nút menu mở Sheet điều hướng (mẫu admin-web). */
function MobileMenu() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
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
          <SheetTitle className="sr-only">{t("nav.label")}</SheetTitle>
          <SheetDescription className="sr-only">{t("nav.label")}</SheetDescription>
          <div className="pt-12">
            <SidebarNav onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export function Topbar() {
  const authed = useSession((s) => s.status === "authed");
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  return (
    <TopShell
      start={authed ? <MobileMenu /> : null}
      apps={authed ? <Apps /> : null}
      bell={
        authed ? (
          <NotificationBell
            transport={KIT_TRANSPORT}
            onNavigate={(href) => void navigate(splitHref(href) as { to: "/" })}
          />
        ) : null
      }
      feedback={
        authed ? (
          <FeedbackButton app="studio" lang={i18n.language} transport={KIT_TRANSPORT} />
        ) : null
      }
      end={authed ? <UserMenu /> : null}
    >
      {authed ? <ConfigBadge /> : null}
    </TopShell>
  );
}
