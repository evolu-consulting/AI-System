// CR-118/CR-120 · component của `/community/*` (nạp lười theo route) — nằm TRONG AppShell dùng chung (routes/_authed.tsx): phiên, cờ tính
// năng, hộp thoại Cài đặt Sổ Hợp Tác đều do khung lo. Ở đây chỉ cấp host cho module (router/đăng xuất/khe thanh trên) rồi tải trang
// Community từ manifest (chunk `community`, có ngân sách riêng); trang chỉ vẽ NỘI DUNG (bảng tin/hồ sơ), không còn header/sidebar riêng.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { loadCommunityPage } from "~/modules/community/manifest";
import { installCommunityHost } from "./community-host";
import { useShellPacks } from "./use-shell-packs";

const Page = lazy(loadCommunityPage);

export function CommunityRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const packs = useShellPacks();
  // ADR-0044 · cờ `community` (Hub tính từ add-on `contracts-community`) tắt ⇒ nói rõ vì sao và ai bật (không trang trắng); cờ đã nạp xong (FeatureRoot chờ trước khi vẽ).
  if (packs.community === false)
    return (
      <EmptyState
        kind="off"
        full
        testId="community-off"
        title={t("contracts.packState.communityOff.title")}
        hint={t("contracts.packState.communityOff.body")}
      />
    );
  installCommunityHost(router); // trước khi module dựng ngữ cảnh; idempotent
  return (
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  );
}
