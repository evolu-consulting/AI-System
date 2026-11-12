// UC-07 · `/c/:id` không tồn tại / không thuộc người dùng (Hub 404) → câu báo + về trang chào. CR-131: hình dùng chung.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <EmptyState
      full
      kind="notFound"
      title={t("thread.notFound")}
      action={
        <Button asChild variant="outline">
          <Link to="/c/new">{t("thread.backHome")}</Link>
        </Button>
      }
    />
  );
}
