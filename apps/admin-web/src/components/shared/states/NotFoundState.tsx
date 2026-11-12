// ADM-FR-60 · 404 (thực thể không tồn tại hoặc thuộc tenant khác, không phân biệt: BR-09).

import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

type Props = {
  backTo:
    | "/"
    | "/tenants"
    | "/users"
    | "/partners"
    | "/secrets"
    | "/workflows"
    | "/commands"
    | "/features"
    | "/apps"
    | "/groups"
    | "/agents"
    | "/processes";
};

export function NotFoundState({ backTo }: Props) {
  const { t } = useTranslation();
  return (
    <EmptyState
      full
      kind="notFound"
      title={t("state.notFound.title")}
      hint={t("state.notFound.body")}
      action={
        <Button asChild>
          <Link to={backTo}>{t("state.notFound.cta")}</Link>
        </Button>
      }
    />
  );
}
