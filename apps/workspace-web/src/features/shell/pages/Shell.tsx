// PK-FR-10 · TF5 · khung app trong `_authed`: sidebar · header · nội dung · khoang phải (trợ lý lazy) · thanh dưới (điện thoại) ·
// nút nổi "Mở trợ lý AI" · sheet ở điện thoại. Layout từ mgmt-app Shell.tsx; quyền (`write`/`owner`) do PackFrame truyền vào.
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";
import { assistantVisible } from "~/features/assistant/lib/chat.rules";
import { logout } from "~/features/auth/api";
import { useUnreadTotal } from "~/features/messages/hooks/use-unread";
import { SettingsDialogLazy } from "~/features/settings/components/SettingsDialogLazy";
import { useBrandSync } from "~/features/settings/hooks/use-settings";
import { cn } from "~/lib/utils";
import { AssistantFab } from "~/shared/ui/AssistantFab";
import { useNavPath } from "~/shell/use-nav-path";
import { useShellPacks } from "~/shell/use-shell-packs";
import { AssistantDock } from "../components/AssistantDock";
import { BottomNav } from "../components/BottomNav";
import { DockSheet } from "../components/DockSheet";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import type { ShellUser } from "../components/UserMenu";
import { useDock } from "../hooks/use-dock";
import { fabHiddenOn, layoutOf, roleOf } from "../lib/nav";
import { NAV_PINNED_KEY, useStoredBool } from "../lib/stored";

type T = (k: string, o?: Record<string, unknown>) => string;
/** Nhãn đọc màn hình của nút mở khoang: kèm số tin chưa đọc khi có. */
const fabLabel = (t: T, unread: number): string =>
  unread > 0
    ? `${t("contracts.shell.openAssistant")} · ${t("contracts.messages.unread", { n: unread })}`
    : t("contracts.shell.openAssistant");

/** Đồng bộ thương hiệu khi có gói Sổ Hợp Tác; trả tổng tin chưa đọc (cho nút mở khoang). */
function useContractsSync(showAssistant: boolean): number {
  const hasContracts = useShellPacks().contracts === true;
  useBrandSync(hasContracts);
  return useUnreadTotal(showAssistant && hasContracts);
}

/** Lớp ẩn của nút nổi trợ lý: khoang đang mở / sheet / thẻ HĐ trên điện thoại / màn «Tin nhắn» (nút nổi che nút Gửi; tin nhắn đã có khoang riêng ở các trang khác). */
const fabClass = (o: {
  open: boolean;
  sheet: boolean;
  onCard: boolean;
  pathname: string;
}): string =>
  cn(
    o.open && "lg:hidden",
    o.sheet && "hidden",
    o.onCard && "max-md:hidden",
    fabHiddenOn(o.pathname) && "hidden",
  );

export function Shell({ user, write, owner }: { user: ShellUser; write: boolean; owner: boolean }) {
  const { t } = useTranslation();
  const pathname = useNavPath();
  const layout = layoutOf(pathname);
  // CR-125 · UX L1 · thẻ hợp đồng trên điện thoại: nút trợ lý nổi che nút Duyệt/Ký ⇒ ẩn (vẫn có ở desktop).
  const onCard = /^\/contracts\/c\/(?!new(?:\/|$))[^/]+\/?$/.test(pathname);
  const dock = useDock();
  const showAssistant = assistantVisible(user?.role, user?.kind); // đối tác không có trợ lý (Chat AI bị chặn phía Hub)
  const unread = useContractsSync(showAssistant);
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
          {dock.open && (showAssistant || dock.mode === "feedback") && (
            <AssistantDock
              mode={dock.mode}
              panel={dock.panel}
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
      {showAssistant && (
        <AssistantFab
          onClick={dock.openAssistant}
          label={fabLabel(t, unread)}
          badge={unread}
          tooltip={t("contracts.shell.askAssistant")}
          icon={<IconRobot width={24} height={24} />}
          className={fabClass({ open: dock.open, sheet: dock.sheet !== null, onCard, pathname })}
        />
      )}
      {dock.sheet && (
        <DockSheet
          mode={dock.sheet}
          panel={dock.panel}
          name={sheetName}
          onClose={dock.closeSheet}
        />
      )}
    </div>
  );
}
