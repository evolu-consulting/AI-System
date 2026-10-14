// ADM-FR-68 · FS6 · khối "Kiểm tra kết nối" trong drawer: nút (khoá khi chưa lưu / có thay đổi / đang chạy) + kết quả
// `status` (200) hoặc `alert` (lỗi, câu tĩnh theo mã). SHA đủ 40 ký tự nằm ở `title`.
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTr } from "@/lib/use-translate";
import type { CheckState } from "../hooks/use-source-check";

type Props = {
  state: CheckState;
  /** Vì sao nút bị khoá (rỗng = được bấm). */
  blocked: "unsaved" | "dirty" | null;
  onRun: () => void;
};

export function CheckPanel({ state, blocked, onRun }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  const running = state.phase === "running";
  return (
    <section className="space-y-2" aria-label={t("process.sources.row.check")}>
      <Button
        type="button"
        variant="outline"
        disabled={blocked !== null || running}
        onClick={onRun}
      >
        {running ? <Loader2 aria-hidden className="animate-spin" /> : null}
        {t("process.sources.row.check")}
      </Button>
      {blocked ? (
        <p className="text-caption text-muted-foreground">
          {t(
            blocked === "unsaved"
              ? "process.sources.check.saveFirst"
              : "process.sources.check.dirty",
          )}
        </p>
      ) : null}
      {running ? (
        <p className="text-caption text-muted-foreground">{t("process.sources.check.running")}</p>
      ) : null}
      {state.phase === "ok" ? (
        <output
          className="block rounded-md border border-border bg-card px-3 py-2 text-body"
          title={state.sha}
        >
          {tr(`process.sources.${state.summary.key}`, state.summary.params)}
        </output>
      ) : null}
      {state.phase === "error" ? (
        <Alert variant="destructive">
          <p>{tr(state.key)}</p>
          {state.hintKey ? <p className="mt-1 text-caption">{tr(state.hintKey)}</p> : null}
        </Alert>
      ) : null}
    </section>
  );
}
