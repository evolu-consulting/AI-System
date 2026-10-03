// CHAT-AC-16 · flow nghỉ lâu: spinner + "Đang mở lại flow, lần đầu có thể mất vài giây…" tới `run.started`/delta đầu.
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ColdResumeNote() {
  const { t } = useTranslation();
  return (
    <p role="status" className="flex items-center gap-2 text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {t("flow.cold")}
    </p>
  );
}
