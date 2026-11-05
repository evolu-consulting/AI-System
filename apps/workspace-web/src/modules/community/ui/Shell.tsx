// COM-FR-27/28/31 · CR-120 · nội dung Community (Bảng tin / Hồ sơ) + hộp thoại Cài đặt + trợ lý giá. Khung (menu trái, thanh trên, menu
// tài khoản, giao diện sáng/tối) là AppShell dùng chung của workspace-web; module chỉ đóng góp ô tìm + chuông vào khe thanh trên.
import { useApp } from "../application/ctx";
import { ChatDock } from "./ChatDock";
import { FeedPage } from "./Feed";
import { ProfilePage } from "./Profile";
import { SettingsDialog } from "./SettingsDialog";
import { TopbarContrib } from "./TopBar";

export function Shell() {
  const { route } = useApp();
  return (
    <div className="app">
      <TopbarContrib />
      <div className="shellmain">
        {route.name === "feed" && <FeedPage />}
        {route.name === "profile" && <ProfilePage />}
      </div>
      <SettingsDialog />
      <ChatDock />
    </div>
  );
}
