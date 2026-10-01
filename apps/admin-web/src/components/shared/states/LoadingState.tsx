// ADM-FR-60 · trạng thái tải: skeleton đúng hình (children) + `status` ẩn "Đang tải"; > 10 s thêm gợi ý và Thử lại.
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const SLOW_LOADING_MS = 10_000;

type Props = { children?: ReactNode; onRetry?: () => void };

export function LoadingState({ children, onRetry }: Props) {
  const { t } = useTranslation();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setSlow(true), SLOW_LOADING_MS);
    return () => clearTimeout(id);
  }, []);
  return (
    <div aria-busy="true" className="space-y-3">
      <output className="sr-only">{t("common.loading")}</output>
      {children === undefined ? <Skeleton className="h-10 w-full" /> : children}
      {slow ? (
        <div className="flex items-center gap-3 text-body text-muted-foreground">
          <span>{t("common.stillLoading")}</span>
          {onRetry ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t("common.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
