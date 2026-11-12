// CHAT-AC-45 · phòng lạ / không thuộc tôi / đã xoá: cùng một màn (Hub trả 404 không phân biệt). CR-131: hình dùng chung.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function RoomNotFound() {
  const { t } = useTranslation();
  return (
    <EmptyState
      full
      kind="notFound"
      title={t("rooms.notFound.title")}
      hint={t("rooms.notFound.body")}
      action={
        <Button asChild variant="outline">
          <Link to="/c/new">{t("rooms.notFound.back")}</Link>
        </Button>
      }
    />
  );
}
