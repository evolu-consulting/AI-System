// ADM-FR-54 · tab Export (ms §8): 6 checkbox có số đếm từ /export/meta + "Chọn tất cả" tri-state + nút Tải file.
import { TRANSFER_TYPES } from "@ai/contracts";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { loadError } from "@/lib/load-error";
import { useExport } from "../hooks/use-export";

export function ExportTab() {
  const { t } = useTranslation();
  const x = useExport();
  const { meta } = x;
  const err = meta.isError
    ? (loadError(meta.error) ?? { message: t("common.unavailable"), code: "HTTP_ERROR" })
    : null;
  const none = x.picked.size === 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("transfer.export.pick")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {err ? (
          <ErrorState {...err} onRetry={() => void meta.refetch()} />
        ) : !meta.data ? (
          <div className="space-y-3" aria-busy="true">
            {TRANSFER_TYPES.map((k) => (
              <Skeleton key={k} className="h-5 w-40" />
            ))}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Checkbox
                id="export-all"
                checked={x.all}
                onCheckedChange={(v) => x.toggleAll(v === true)}
              />
              <Label htmlFor="export-all">{t("transfer.export.selectAll")}</Label>
            </div>
            <ul className="space-y-3 border-t pt-4">
              {TRANSFER_TYPES.map((k) => (
                <li key={k} className="flex items-center gap-2">
                  <Checkbox
                    id={`export-${k}`}
                    checked={x.picked.has(k)}
                    onCheckedChange={(v) => x.toggle(k, v === true)}
                  />
                  <Label htmlFor={`export-${k}`}>
                    {t(`transfer.export.type.${k}`)} ({meta.data.counts[k]})
                  </Label>
                </li>
              ))}
            </ul>
            <p className="text-label text-muted-foreground">{t("transfer.export.note")}</p>
            {none ? (
              <p role="status" className="text-label text-destructive">
                {t("transfer.export.none")}
              </p>
            ) : null}
            <Button onClick={x.submit} disabled={none || x.downloading}>
              <Download aria-hidden className="size-4" />
              {t("transfer.export.download", { file: x.file })}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
