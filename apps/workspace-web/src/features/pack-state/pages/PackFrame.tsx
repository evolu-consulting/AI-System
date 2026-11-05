// PK-FR-05 · PK-FR-10 · TF4 · CR-120 · khung vùng `_authed`: nghe hết phiên/đăng xuất rồi dựng MỘT AppShell dùng chung cho mọi module
// (Sổ Hợp Tác `/contracts/*`, Community `/community/*`). KHÔNG gọi `/pack/contracts/me` ở đây: đối tác (không gói contracts) vào Community
// không được phát sinh lời gọi gói contracts; cổng gói + quyền ghi/chủ sở hữu do ShellFeatured (khi gói contracts bật) và ContractsGate lo.
import { lazy, Suspense } from "react";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";

// CR-118: Shell + OpenFeature (web-sdk/react-sdk) tách chunk riêng để bundle đầu giữ ngân sách (JS 162 KB).
const ShellFeatured = lazy(() => import("./ShellFeatured"));

export function PackFrame() {
  useSessionRedirect();
  return (
    <Suspense fallback={null}>
      <ShellFeatured />
    </Suspense>
  );
}
