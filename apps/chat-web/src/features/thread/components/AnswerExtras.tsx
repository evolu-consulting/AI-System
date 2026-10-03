// CHAT-AC-12, CHAT-AC-24, CHAT-AC-10 · SLOT cho F9: bản tối thiểu của hỏi lại / lỗi / đã dừng.
// F9 thay phần thân bằng AskCard (chip), ErrorCard (Thử lại, Báo admin), CancelledNote (Chạy lại) — giữ nguyên props.
import { useTranslation } from "react-i18next";
import type { AnswerView } from "../lib/thread-logic";

const KNOWN_CODES = new Set([
  "ALL_PROVIDERS_EXHAUSTED",
  "TIMEOUT",
  "UPSTREAM_ERROR",
  "BUDGET_EXCEEDED",
  "NOT_CONFIGURED",
]);

export function AnswerExtras({ answer }: { answer: AnswerView }) {
  const { t } = useTranslation();
  const { ask, error, cancelled } = answer;
  return (
    <>
      {ask && (
        <section
          aria-label={t("ask.title")}
          className="flex flex-col gap-1 rounded-lg border border-primary p-3"
        >
          <p className="text-label font-semibold">{t("ask.title")}</p>
          <p>{ask.question}</p>
        </section>
      )}
      {error && (
        <div role="alert" className="flex flex-col gap-1 rounded-lg bg-danger-bg p-3 text-danger">
          <p className="font-semibold">
            {t(`errors.${KNOWN_CODES.has(error.code) ? error.code : "unknown"}.title`)}
          </p>
          <p className="font-mono text-caption">
            {t("errors.meta", { code: error.code, runId: error.runId ?? "—" })}
          </p>
        </div>
      )}
      {cancelled && <p className="text-caption text-muted-foreground">{t("run.cancelled")}</p>}
    </>
  );
}
