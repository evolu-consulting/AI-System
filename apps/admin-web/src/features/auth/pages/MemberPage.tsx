// ADM-FR-03 · /member: tài khoản member dùng Chat App, không dùng trang quản trị (D8).
import { Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { session } from "@/lib/auth/session";
import { useDocumentTitle } from "@/lib/use-document-title";

const CHAT_APP_URL = import.meta.env.PUBLIC_CHAT_APP_URL;

export function MemberPage() {
  const { t } = useTranslation();
  const router = useRouter();
  useDocumentTitle(t("member.title"));

  const signOut = async () => {
    await session.logout();
    await router.navigate({ to: "/login", search: {} });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-page-title font-bold text-foreground">{t("member.title")}</h1>
        <p className="text-body text-muted-foreground">{t("member.body")}</p>
      </div>
      <div className="flex flex-col gap-2">
        {CHAT_APP_URL ? (
          <Button asChild>
            <a href={CHAT_APP_URL}>{t("member.open")}</a>
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <Link to="/account/password">{t("account.changePassword")}</Link>
        </Button>
        <Button variant="ghost" onClick={signOut}>
          {t("auth.logout")}
        </Button>
      </div>
    </div>
  );
}
