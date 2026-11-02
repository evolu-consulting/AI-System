// COM-FR-27/28/31 · Shell: Topbar + Sidebar cố định + vùng nội dung (Bảng tin / Hồ sơ) + hộp thoại Cài đặt + trợ lý giá.
// Sidebar sống ở Shell nên đổi Bảng tin ↔ Hồ sơ không mất trạng thái xổ/gập. ≤ 900 px Sidebar là drawer (burger ở Topbar).
import { useEffect, useState } from "react";
import { ChatDock } from "./ChatDock";
import { useApp } from "./ctx";
import { FeedPage } from "./Feed";
import { ProfilePage } from "./Profile";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

export function Shell() {
  const { route, settingsOpen } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  // Đổi trang hoặc mở Cài đặt ⇒ đóng drawer; Esc đóng drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ chạy khi route/settings đổi
  useEffect(() => setNavOpen(false), [route.name, route.orgId, settingsOpen]);
  useEffect(() => {
    if (!navOpen) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [navOpen]);
  return (
    <div className="app">
      <TopBar navOpen={navOpen} onToggleNav={() => setNavOpen((o) => !o)} />
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="shellmain">
        {route.name === "feed" && <FeedPage />}
        {route.name === "profile" && <ProfilePage />}
      </div>
      <SettingsDialog />
      <ChatDock />
    </div>
  );
}
