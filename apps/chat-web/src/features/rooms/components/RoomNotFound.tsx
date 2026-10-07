// CHAT-AC-45 · phòng lạ / không thuộc tôi / đã xoá: cùng một màn (Hub trả 404 không phân biệt).
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function RoomNotFound() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-card-title font-semibold">{t("rooms.notFound.title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("rooms.notFound.body")}</p>
      <Button asChild variant="outline">
        <Link to="/c/new">{t("rooms.notFound.back")}</Link>
      </Button>
    </div>
  );
}
