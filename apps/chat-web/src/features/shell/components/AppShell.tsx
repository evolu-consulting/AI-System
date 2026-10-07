// CHAT-AC-18, CHAT-AC-23 · khung app: ≥ 1024 sidebar 260px cố định; < 1024 header 56px (☰) + sidebar trong Sheet trái.
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConnectionBanner } from "~/components/shared/ConnectionBanner";
import { Button } from "~/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "~/components/ui/sheet";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";
import { useMeStream } from "~/features/realtime/hooks/use-me-stream";
import { useSession } from "~/lib/auth/use-session";
import { useConnection } from "../hooks/use-connection";
import { useDebouncedValue } from "../hooks/use-debounced-value";
import { useIsDesktop } from "../hooks/use-is-desktop";
import { useSettings } from "../hooks/use-settings";
import { useShortcuts } from "../hooks/use-shortcuts";
import { conversationIdOf } from "../lib/conversation-path";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";

const SEARCH_DEBOUNCE_MS = 250;

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const desktop = useIsDesktop();
  const settings = useSettings();
  useSessionRedirect();
  useMeStream();
  const conn = useConnection();
  const tenantName = useSession((s) => s.me?.tenant.name ?? "");
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const wantSearch = useRef(false);

  const onNewChat = useCallback(() => void navigate({ to: "/c/new" }), [navigate]);
  const onSearch = useCallback(() => {
    if (desktop) {
      searchRef.current?.focus();
    } else {
      wantSearch.current = true;
      setSheetOpen(true);
    }
  }, [desktop]);
  useShortcuts({ onNewChat, onSearch });

  const sidebar = (onNavigate?: () => void) => (
    <Sidebar
      tenantName={tenantName}
      displayName={settings.displayName}
      username={settings.username}
      query={query}
      debouncedQuery={debounced}
      onQueryChange={setQuery}
      searchRef={searchRef}
      activeId={conversationIdOf(pathname)}
      onNavigate={onNavigate}
      onOpenSettings={() => setSettingsOpen(true)}
    />
  );

  return (
    <div className="flex h-dvh bg-background">
      {desktop && <div className="h-full">{sidebar()}</div>}
      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && (
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={t("shell.openList")}
              onClick={() => setSheetOpen(true)}
            >
              <Menu aria-hidden />
            </Button>
            <span className="truncate text-sm font-semibold">
              {t("shell.brand", { tenant: tenantName })}
            </span>
          </header>
        )}
        {conn.kind && <ConnectionBanner kind={conn.kind} onRetry={conn.retry} />}
        <main id="main" className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      {!desktop && (
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-[260px] max-w-[85vw] gap-0 p-0"
            aria-describedby={undefined}
            onOpenAutoFocus={(e) => {
              if (!wantSearch.current) return;
              wantSearch.current = false;
              e.preventDefault();
              searchRef.current?.focus();
            }}
          >
            <SheetTitle className="sr-only">{t("shell.openList")}</SheetTitle>
            {sidebar(() => setSheetOpen(false))}
          </SheetContent>
        </Sheet>
      )}
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} {...settings} />
    </div>
  );
}
