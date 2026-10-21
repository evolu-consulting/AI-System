// ADM-FR-60, ADM-FR-03 · layout của route `_authed`: khung quản trị; `member` dùng bố cục ngoài khung (D8).
import { FeedbackFab } from "@ai/web-kit/ui/FeedbackFab";
import { Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useSession } from "@/lib/auth/use-session";
import { api, apiResponse } from "@/lib/http";
import { AppShell } from "./AppShell";
import { BareLayout } from "./BareLayout";

/** Client HTTP riêng của admin-web (kit không biết token của web này). */
const FEEDBACK_TRANSPORT = {
  request: api,
  blob: async (path: string) => (await apiResponse(path)).blob(),
};

export function AuthedLayout() {
  const isMember = useSession((s) => s.me?.role === "member");
  const { i18n } = useTranslation();
  const fab = <FeedbackFab app="admin" lang={i18n.language} transport={FEEDBACK_TRANSPORT} />;
  if (isMember) {
    return (
      <>
        <BareLayout width="wide">
          <Outlet />
        </BareLayout>
        {fab}
      </>
    );
  }
  return (
    <>
      <AppShell>
        <Outlet />
      </AppShell>
      {fab}
    </>
  );
}
