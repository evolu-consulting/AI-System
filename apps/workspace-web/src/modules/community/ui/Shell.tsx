// COM-FR-27/28/31 · CR-120 · nội dung Community (Bảng tin / Hồ sơ) + hộp thoại Cài đặt + trợ lý giá. Khung (menu trái, thanh trên, menu
// tài khoản, giao diện sáng/tối) là AppShell dùng chung của workspace-web; module chỉ đóng góp ô tìm + chuông vào khe thanh trên.
import { lazy, Suspense } from "react";
import { useApp } from "../application/ctx";
import { ChatDock } from "./ChatDock";
import { FeedPage } from "./Feed";
import { ProfilePage } from "./Profile";
import { SettingsDialog } from "./SettingsDialog";
import { TopbarContrib } from "./TopBar";

// CR-120: 3 màn luồng tải lười (chunk riêng, người không có quyền không tải).
const ReviewQueuePage = lazy(() => import("./flows/ReviewQueue"));
const JoinRequestsPage = lazy(() => import("./flows/JoinRequests"));
const ReportsPage = lazy(() => import("./flows/Reports"));

export function Shell() {
  const { route } = useApp();
  return (
    <div className="app">
      <TopbarContrib />
      <div className="shellmain">
        {route.name === "feed" && <FeedPage />}
        {route.name === "profile" && <ProfilePage />}
        <Suspense fallback={null}>
          {route.name === "review" && <ReviewQueuePage />}
          {route.name === "join" && <JoinRequestsPage />}
          {route.name === "reports" && <ReportsPage />}
        </Suspense>
      </div>
      <SettingsDialog />
      <ChatDock />
    </div>
  );
}
