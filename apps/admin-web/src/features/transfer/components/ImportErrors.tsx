// ADM-FR-54 · M4-R14 · lỗi file import (ms §8): Alert "File không hợp lệ" + danh sách `đường dẫn: lý do` (≤ 100 mục từ server).
import type { ImportError } from "@ai/contracts";
import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ImportErrors({ errors }: { errors: ImportError[] }) {
  const { t } = useTranslation();
  return (
    <Alert variant="destructive">
      <AlertCircle aria-hidden />
      <AlertTitle>{t("transfer.import.invalid")}</AlertTitle>
      <AlertDescription>
        <ul className="mt-1 max-h-72 list-disc space-y-1 overflow-auto pl-4">
          {errors.map((e) => (
            <li
              key={`${e.path}:${e.code}:${e.line ?? 0}:${e.col ?? 0}:${e.message}`}
              className="break-words"
            >
              {e.path ? <span className="font-mono">{e.path}</span> : null}
              {e.path ? ": " : null}
              {e.message}
              {e.line ? (
                <span className="text-muted-foreground">
                  {" "}
                  ({t("transfer.import.errorAt", { line: e.line, col: e.col ?? 1 })})
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
