// UC-07 · `/c/:id` không tồn tại / không thuộc người dùng (Hub 404) → câu báo + về trang chào.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function NotFoundState() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-card-title font-semibold">{t("thread.notFound")}</h1>
      <Button asChild variant="outline">
        <Link to="/c/new">{t("thread.backHome")}</Link>
      </Button>
    </div>
  );
}
