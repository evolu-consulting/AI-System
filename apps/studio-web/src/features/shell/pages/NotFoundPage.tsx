// HUB-FR-72 · 404 "Không tìm thấy trang" + nút về Agents (plan-frontend §2).
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "#/components/ui/button";
import { AppShell } from "../components/AppShell";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <SearchX aria-hidden className="size-8 text-primary/50" />
        <h1 className="text-page-title font-bold text-foreground">{t("notFound.title")}</h1>
        <Button asChild>
          <Link to="/agents">{t("notFound.back")}</Link>
        </Button>
      </div>
    </AppShell>
  );
}
