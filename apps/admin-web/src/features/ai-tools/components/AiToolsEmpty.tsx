// CR-121 R6 · c16 · trạng thái rỗng của danh sách: chưa có công cụ · lọc "Chưa dùng" mà mọi công cụ đều có người dùng · không khớp.
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AiToolFilters } from "../lib/ai-tools";

type Props = { filters: AiToolFilters; onClear: () => void };

export function AiToolsEmpty({ filters, onClear }: Props) {
  const { t } = useTranslation();
  const { status, kind, q, secret } = filters;
  if (!status && !kind && !q && !secret)
    return (
      <EmptyState
        title={t("aiTools.empty")}
        message={t("aiTools.emptyDesc")}
        action={
          <Link to="/workflows/new" className={buttonVariants({ variant: "outline" })}>
            {t("aiTools.create")}
          </Link>
        }
      />
    );
  const onlyUnused = status === "unused" && !kind && !q;
  return (
    <EmptyState
      kind="search"
      message={t(onlyUnused ? "aiTools.allUsed" : "aiTools.noMatch")}
      action={
        <Button variant="outline" onClick={onClear}>
          {t(onlyUnused ? "aiTools.showAll" : "common.clearFilters")}
        </Button>
      }
    />
  );
}
