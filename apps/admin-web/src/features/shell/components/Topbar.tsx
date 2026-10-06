// ADM-FR-60 · topbar: nút menu (di động), breadcrumb, badge ("Nền tảng" / tên tenant), menu avatar.
import { Link, useLocation } from "@tanstack/react-router";
import { ArrowLeftRight, Menu } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useSession } from "@/lib/auth/use-session";
import { STUDIO_URL } from "@/lib/env";
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

export function Topbar() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const role = useSession((s) => s.me?.role);
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  return (
    <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-card px-4">
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
      <div className="ml-auto flex items-center gap-3">
        {role === "platform_admin" ? (
          <StatusBadge tone="info">{t("topbar.platform")}</StatusBadge>
        ) : (
          <span className="text-label text-muted-foreground">{tenantName}</span>
        )}
        {role === "platform_admin" && STUDIO_URL ? (
          <a
            href={STUDIO_URL}
            aria-label={t("topbar.studio")}
            className="inline-flex h-9 items-center gap-2 rounded-md px-2 text-label text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeftRight className="size-4" aria-hidden />
            <span className="hidden sm:inline">{t("topbar.studio")}</span>
          </a>
        ) : null}
        <AccountMenu />
      </div>
    </header>
  );
}
