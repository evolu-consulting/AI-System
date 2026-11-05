// CR-120 · cổng gói contracts cho vùng `/contracts/*` (trước CR-120 bọc cả khung): đang tải / lỗi nạp `/pack/contracts/me` / chưa bật ⇒
// trang trạng thái trong vùng nội dung của AppShell; còn lại ⇒ trang con.
import { Outlet } from "@tanstack/react-router";
import { logout } from "~/features/auth/api";
import { PackGate } from "../components/PackGate";
import { useMe } from "../hooks/use-me";

export function ContractsGate() {
  const me = useMe();
  return (
    <PackGate
      status={me.status}
      view={me.view}
      errorKey={me.errorKey}
      onRetry={me.retry}
      onLogout={() => void logout()}
    >
      <Outlet />
    </PackGate>
  );
}
