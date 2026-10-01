// ADM-FR-60, ADM-FR-03 · layout của route `_authed`: khung quản trị; `member` dùng bố cục ngoài khung (D8).
import { Outlet } from "@tanstack/react-router";
import { useSession } from "@/lib/use-session";
import { AppShell } from "./AppShell";
import { BareLayout } from "./BareLayout";

export function AuthedLayout() {
  const isMember = useSession((s) => s.me?.role === "member");
  if (isMember) {
    return (
      <BareLayout width="wide">
        <Outlet />
      </BareLayout>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
