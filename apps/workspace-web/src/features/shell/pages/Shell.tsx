// PK-FR-10 · TF5 · khung app trong `_authed`: sidebar · header · nội dung · khoang phải (trợ lý lazy) · thanh dưới (điện thoại) ·
// nút nổi "Mở trợ lý AI" · sheet ở điện thoại. Layout từ mgmt-app Shell.tsx; quyền (`write`/`owner`) do PackFrame truyền vào.
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import { logout } from "~/features/auth/api";
import { SettingsDialogLazy } from "~/features/settings/components/SettingsDialogLazy";
import { useBrandSync } from "~/features/settings/hooks/use-settings";
import { cn } from "~/lib/utils";
import { AssistantFab } from "~/shared/ui/AssistantFab";
import { useNavPath } from "~/shell/use-nav-path";
import { useShellPacks } from "~/shell/use-shell-packs";
import { AssistantDock, DockBody } from "../components/AssistantDock";
import { BottomNav } from "../components/BottomNav";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import type { ShellUser } from "../components/UserMenu";
import { useDock } from "../hooks/use-dock";
import { layoutOf, roleOf } from "../lib/nav";
import { NAV_PINNED_KEY, useStoredBool } from "../lib/stored";

export function Shell({ user, write, owner }: { user: ShellUser; write: boolean; owner: boolean }) {
  const { t } = useTranslation();
  const pathname = useNavPath();
  const layout = layoutOf(pathname);
  const inCommunity = pathname === "/community" || pathname.startsWith("/community/");
  // CR-125 · UX L1 · thẻ hợp đồng trên điện thoại: nút trợ lý nổi che nút Duyệt/Ký ⇒ ẩn (vẫn có ở desktop).
  const onCard = /^\/contracts\/c\/(?!new(?:\/|$))[^/]+\/?$/.test(pathname);
  const dock = useDock();
  useBrandSync(useShellPacks().contracts === true);
  const [pinned, setPinned] = useStoredBool(NAV_PINNED_KEY, true);
  const role = roleOf({ write, owner });
  const sheetName =
    dock.sheet === "feedback" ? t("contracts.shell.feedback") : t("contracts.shell.assistant");
  return (
    <div
      className={cn("flex h-dvh overflow-hidden", dock.dragging && "cursor-col-resize select-none")}
    >
      <Sidebar user={user} role={role} pinned={pinned} onLogout={logout} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <Header
          user={user}
          role={role}
          pinned={pinned}
          onTogglePinned={() => setPinned(!pinned)}
          onFeedback={dock.openFeedback}
          onLogout={logout}
        />
        <div className="flex min-h-0 flex-1">
          <main
            className={cn(
              "min-w-0 flex-1 overflow-y-auto px-7 py-7 max-md:px-4 max-md:pb-28",
              layout === "board" && "md:flex md:flex-col md:overflow-hidden",
            )}
          >
            <div
              className={cn(
                "mx-auto w-full",
                layout === "board" &&
                  "max-w-[1600px] md:flex md:min-h-0 md:flex-1 md:flex-col md:overflow-y-auto",
                layout === "wide" && "max-w-[1560px]",
                layout === "reading" && (dock.open ? "max-w-[900px]" : "max-w-[1100px]"),
              )}
            >
              <Outlet />
            </div>
          </main>
          {dock.open && (
            <AssistantDock
              mode={dock.mode}
              width={dock.width}
              dragging={dock.dragging}
              onDragStart={dock.startResize}
              onClose={dock.closeDock}
            />
          )}
        </div>
      </div>
      <BottomNav />
      <SettingsDialogLazy owner={owner} tenantName={user?.tenant.name ?? ""} />
      {/* Community có nút trợ lý riêng (ChatDock, cùng AssistantFab): chỉ MỘT nút nổi ở mỗi module */}
      {!inCommunity && (
        <AssistantFab
          onClick={dock.openAssistant}
          label={t("contracts.shell.openAssistant")}
          tooltip={t("contracts.shell.askAssistant")}
          icon={<IconRobot width={24} height={24} />}
          className={cn(
            dock.open && "lg:hidden",
            dock.sheet && "hidden",
            onCard && "max-md:hidden",
          )}
        />
      )}
      {dock.sheet && (
        <div className="fixed inset-0 z-40 flex flex-col lg:hidden">
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("contracts.common.close")}
            onClick={dock.closeSheet}
            className="absolute inset-0 bg-black/40"
          />
          <div
            role="dialog"
            aria-label={sheetName}
            className="relative mt-auto h-[85dvh] overflow-hidden rounded-t-2xl bg-panel"
          >
            <DockBody
              mode={dock.sheet}
              onClose={dock.closeSheet}
              closeLabel={t("contracts.common.close")}
            />
          </div>
        </div>
      )}{" "}
    </div>
  );
}
