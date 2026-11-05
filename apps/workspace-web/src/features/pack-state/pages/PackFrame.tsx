// PK-FR-05 · PK-FR-10 · TF4 · khung vùng `_authed`: nghe hết phiên/đăng xuất, nạp `/me`, chặn theo trạng thái gói rồi mới
// hiện nội dung. Shell (TF5: sidebar, header…) bọc `<Outlet/>`.
import { lazy, Suspense } from "react";
import { logout } from "~/features/auth/api";
import { useSessionRedirect } from "~/features/auth/hooks/use-session-redirect";
import { PackGate } from "../components/PackGate";
import { useMe } from "../hooks/use-me";

// CR-118: Shell + OpenFeature (web-sdk/react-sdk) tách chunk riêng để bundle đầu giữ ngân sách (JS 162 KB).
const ShellFeatured = lazy(() => import("./ShellFeatured"));

export function PackFrame() {
  useSessionRedirect();
  const me = useMe();
  return (
    <PackGate
      status={me.status}
      view={me.view}
      errorKey={me.errorKey}
      onRetry={me.retry}
      onLogout={() => void logout()}
    >
      <Suspense fallback={null}>
        <ShellFeatured user={me.user} write={me.write} owner={me.owner} />
      </Suspense>
    </PackGate>
  );
}
