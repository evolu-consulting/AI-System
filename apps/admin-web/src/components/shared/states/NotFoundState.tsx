// ADM-FR-60 · 404 (thực thể không tồn tại hoặc thuộc tenant khác, không phân biệt: BR-09).
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = {
  backTo:
    | "/"
    | "/tenants"
    | "/users"
    | "/secrets"
    | "/workflows"
    | "/commands"
    | "/features"
    | "/groups"
    | "/agents";
};

export function NotFoundState({ backTo }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <SearchX aria-hidden className="size-8 text-primary/50" />
      <h1 className="text-page-title font-bold text-foreground">{t("state.notFound.title")}</h1>
      <p className="max-w-md text-body text-muted-foreground">{t("state.notFound.body")}</p>
      <Button asChild>
        <Link to={backTo}>{t("state.notFound.cta")}</Link>
      </Button>
    </div>
  );
}
