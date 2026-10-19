// PK-FR-10 · TF5 · khung app trong `_authed`: sidebar · header · nội dung · khoang phải (trợ lý lazy) · thanh dưới (điện thoại) ·
// nút nổi "Mở trợ lý AI" · sheet ở điện thoại. Layout từ mgmt-app Shell.tsx; quyền (`write`/`owner`) do PackFrame truyền vào.
import { Outlet, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import { logout } from "~/features/auth/api";
import { cn } from "~/lib/utils";
import { AssistantDock, DockBody } from "../components/AssistantDock";
import { BottomNav } from "../components/BottomNav";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import type { ShellUser } from "../components/UserMenu";
import { useDock } from "../hooks/use-dock";
import { activeNav, roleOf } from "../lib/nav";

export function Shell({ user, write, owner }: { user: ShellUser; write: boolean; owner: boolean }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const dock = useDock();
  const role = roleOf({ write, owner });
  const sheetName =
    dock.sheet === "feedback" ? t("contracts.shell.feedback") : t("contracts.shell.assistant");
  return (
    <div
      className={cn("flex h-dvh overflow-hidden", dock.dragging && "cursor-col-resize select-none")}
    >
      <Sidebar user={user} role={role} onLogout={logout} />
      <div className="flex h-dvh min-w-0 flex-1 flex-col">
        <Header
          here={activeNav(pathname)}
          user={user}
          role={role}
          onFeedback={dock.openFeedback}
          onLogout={logout}
        />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto px-7 py-7 max-md:px-4 max-md:pb-28">
            <div className={cn("mx-auto w-full", dock.open ? "max-w-[900px]" : "max-w-[1100px]")}>
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
      <button
        type="button"
        onClick={dock.openAssistant}
        aria-label={t("contracts.shell.openAssistant")}
        title={t("contracts.shell.assistant")}
        className={cn(
          "fixed right-5 bottom-20 z-30 grid h-12 w-12 place-items-center rounded-full bg-act text-on-act shadow-toast transition-transform hover:scale-105 active:scale-95 md:right-6 md:bottom-6",
          dock.open && "lg:hidden",
          dock.sheet && "hidden",
        )}
      >
        <IconRobot width={24} height={24} />
      </button>
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
