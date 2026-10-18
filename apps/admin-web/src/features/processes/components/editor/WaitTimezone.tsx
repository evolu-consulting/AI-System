// ADM-FR-71 · HUB-FR-143 · P-d1 (plan-frontend §2; mockup A1/A2): dòng múi giờ của khối "Chờ tới ngày" — tải / lỗi / mẫu / công ty.
// Múi giờ lấy từ `GET /process-editor/context`; lỗi tải không chặn lưu (Hub vẫn kiểm).
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { utcOffsetLabel } from "@/lib/tz-format";
import { useProcessTimezone } from "../../hooks/use-process-timezone";

const K = "process.admin.editor.stage.wait.";

/** `id` được ô "Giờ trong ngày" trỏ tới bằng `aria-describedby`. */
export function WaitTimezone({ id }: { id: string }) {
  const { t } = useTranslation();
  const { timezone: tz, isError, refetch, isTemplate } = useProcessTimezone();
  return (
    <div id={id} className="space-y-1.5">
      {isError ? (
        <Alert variant="destructive" role="alert" className="flex items-center gap-2 bg-danger-bg">
          <AlertDescription className="flex-1">{t(`${K}tzError`)}</AlertDescription>
          <Button type="button" size="sm" variant="outline" onClick={refetch}>
            {t("process.admin.canvas.retry")}
          </Button>
        </Alert>
      ) : tz === undefined ? (
        <div aria-busy="true" className="space-y-1.5">
          <p className="text-caption text-muted-foreground">{t(`${K}tzLoading`)}</p>
          <Skeleton className="h-3.5 w-3/5" />
        </div>
      ) : (
        <Alert role="status">
          <AlertDescription>
            {isTemplate
              ? t(`${K}tzTemplate`, { tz })
              : t(`${K}tz`, { tz, offset: utcOffsetLabel(tz, new Date().toISOString()) })}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
