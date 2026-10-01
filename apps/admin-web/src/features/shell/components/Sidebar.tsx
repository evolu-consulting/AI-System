// ADM-FR-60 · sidebar 248px (D18), thu gọn 64px bằng nút hoặc phím `[`, nhớ `ai.sidebarCollapsed`; < 1024px ẩn.
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth/use-session";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./SidebarNav";

const STORAGE_KEY = "ai.sidebarCollapsed";

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === "1");
  const toggle = useCallback(
    () =>
      setCollapsed((c) => {
        localStorage.setItem(STORAGE_KEY, c ? "0" : "1");
        return !c;
      }),
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
  return [collapsed, toggle];
}

export function UserFooter({ collapsed }: { collapsed: boolean }) {
  const name = useSession((s) => s.me?.display_name ?? "");
  const role = useSession((s) => s.me?.role ?? "");
  const tenant = useSession((s) => s.me?.tenant.key ?? "");
  return (
    <div className="flex items-center gap-3 border-t border-sidebar-border p-3">
      <span
        aria-hidden
        className="grid size-8 shrink-0 place-items-center rounded-full bg-sidebar-accent text-label font-semibold text-sidebar-accent-foreground"
      >
        {name.charAt(0).toUpperCase()}
      </span>
      {collapsed ? null : (
        <div className="min-w-0">
          <p className="truncate text-label font-medium text-foreground">{name}</p>
          <p className="truncate text-caption text-muted-foreground">
            {role} · {tenant}
          </p>
        </div>
      )}
    </div>
  );
}

export function Sidebar() {
  const { t } = useTranslation();
  const [collapsed, toggle] = useCollapsed();
  const label = collapsed ? t("nav.expand") : t("nav.collapse");
  return (
    <aside
      className={cn(
        "hidden shrink-0 flex-col border-r border-sidebar-border bg-sidebar transition-[width] lg:flex",
        collapsed ? "w-sidebar-icon" : "w-sidebar",
      )}
    >
      <div className="flex h-topbar items-center justify-between gap-2 px-3">
        {collapsed ? null : (
          <img
            src="/brand/evoluconsulting-logo-horizontal.svg"
            alt="EvoluConsulting"
            width={140}
            height={43}
            className="h-8 w-auto"
          />
        )}
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label} onClick={toggle}>
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        </Button>
      </div>
      <SidebarNav collapsed={collapsed} />
      <UserFooter collapsed={collapsed} />
    </aside>
  );
}
