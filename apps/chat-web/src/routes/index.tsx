// portal-home · `/` = trang chủ AI System (guard phiên tại chỗ). Có app mặc định (cá nhân > công ty) và không `?home=1` ⇒ vào thẳng app đó
// (Chat AI → `/c/new`, app khác → chuyển phiên SSO); lấy mặc định lỗi ⇒ vẫn vào trang chủ.
import { createFileRoute, redirect } from "@tanstack/react-router";
import { requireSession } from "~/features/auth/lib/guard";
import { decideLanding } from "~/features/portal/lib/landing";
import { LandingGate } from "~/features/portal/pages/LandingGate";

export type IndexSearch = { home?: 1 };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): IndexSearch => ({
    home: s.home === 1 || s.home === "1" ? 1 : undefined,
  }),
  beforeLoad: async ({ location, search }) => {
    await requireSession(location);
    const landing = await decideLanding(search.home === 1);
    if (landing.kind === "chat") throw redirect({ to: "/c/new" });
    return { landing };
  },
  component: LandingGate,
});
