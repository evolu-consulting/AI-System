// ADM-FR-60 · 403 trong khung: icon khoá + H1 + giải thích + "Về Tổng quan".
import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/use-document-title";

export function ForbiddenState() {
  const { t } = useTranslation();
  useDocumentTitle(t("state.forbidden.title"));
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <Lock aria-hidden className="size-8 text-primary/50" />
      <h1 className="text-page-title font-bold text-foreground">{t("state.forbidden.title")}</h1>
      <p className="max-w-md text-body text-muted-foreground">
        {t("state.forbidden.platformOnly")}
      </p>
      <Button asChild>
        <Link to="/">{t("state.forbidden.cta")}</Link>
      </Button>
    </div>
  );
}
