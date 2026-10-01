// ADM-FR-60 · 404 chung: trong khung nếu đã đăng nhập, ngoài khung (mẫu D) nếu chưa.
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { useSession } from "@/lib/use-session";
import { AppShell } from "../components/AppShell";
import { BareLayout } from "../components/BareLayout";

export function NotFoundPage() {
  const authed = useSession((s) => s.status === "authed");
  return authed ? (
    <AppShell>
      <NotFoundState backTo="/" />
    </AppShell>
  ) : (
    <BareLayout>
      <NotFoundState backTo="/" />
    </BareLayout>
  );
}
