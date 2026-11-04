// CR-118 · component của `/community/*` (nạp lười theo route): phiên chung (hết phiên/đăng xuất ⇒ /login?next=), host cho module
// (router/đăng xuất/điều hướng sang SHT) rồi trang Community tải lười từ manifest (chunk `community`, có ngân sách riêng).
import { useRouter } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";
import { loadCommunityPage } from "~/modules/community/manifest";
import { useFeature } from "~/platform/features";
import { ContractsSettingsHost } from "./ContractsSettingsHost";
import { installCommunityHost } from "./community-host";

const Page = lazy(loadCommunityPage);

export function CommunityRoute() {
  const router = useRouter();
  useSessionRedirect();
  installCommunityHost(router); // trước khi module dựng ngữ cảnh; idempotent
  const contracts = useFeature("contracts");
  return (
    <Suspense fallback={null}>
      <Page />
      {contracts && <ContractsSettingsHost />}
    </Suspense>
  );
}
