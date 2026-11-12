// HUB-FR-72 · 404 "Không tìm thấy trang" + nút về Agents (plan-frontend §2). CR-131: hình dùng chung.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { AppShell } from "../components/AppShell";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <EmptyState
        full
        kind="notFound"
        title={t("notFound.title")}
        action={
          <Button asChild>
            <Link to="/agents">{t("notFound.back")}</Link>
          </Button>
        }
      />
    </AppShell>
  );
}
