// CR-118/CR-120 · component của `/community/*` (nạp lười theo route) — nằm TRONG AppShell dùng chung (routes/_authed.tsx): phiên, cờ tính
// năng, hộp thoại Cài đặt Sổ Hợp Tác đều do khung lo. Ở đây chỉ cấp host cho module (router/đăng xuất/khe thanh trên) rồi tải trang
// Community từ manifest (chunk `community`, có ngân sách riêng); trang chỉ vẽ NỘI DUNG (bảng tin/hồ sơ), không còn header/sidebar riêng.
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { loadCommunityPage } from "~/modules/community/manifest";
import { installCommunityHost } from "./community-host";

const Page = lazy(loadCommunityPage);

export function CommunityRoute() {
  const router = useRouter();
  installCommunityHost(router); // trước khi module dựng ngữ cảnh; idempotent
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
