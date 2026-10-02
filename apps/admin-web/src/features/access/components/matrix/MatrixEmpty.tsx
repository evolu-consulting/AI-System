// ADM-FR-35 · trạng thái rỗng của ma trận: chưa có group nào → gợi ý tạo group.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button } from "@/components/ui/button";

export function MatrixEmpty({ tenantKey }: { tenantKey?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      message={t("access.matrix.noGroups")}
      action={
        <Button asChild>
          <Link to="/groups/new" search={{ tenant: tenantKey }}>
            {t("access.matrix.noGroupsCta")}
          </Link>
        </Button>
      }
    />
  );
}
