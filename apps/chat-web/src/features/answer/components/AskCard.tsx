// CHAT-AC-12, CHAT-AC-13 · hỏi lại: câu hỏi + chip gửi ngay; chip vô hiệu sau khi đã trả lời. Vẫn gõ tự do được.
import { useState } from "react";
import { useTranslation } from "react-i18next";

export type AskCardProps = {
  question: string;
  choices: readonly string[];
  /** Flow đã có tin sau câu hỏi. */
  answered: boolean;
  /** Không có → chip disabled (thiếu ngữ cảnh gửi). */
  onPick?: (choice: string) => void;
};

export function AskCard({ question, choices, answered, onPick }: AskCardProps) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState(false);
  const disabled = answered || picked || !onPick;
  return (
    <section
      aria-label={t("ask.title")}
      className="flex flex-col gap-2 rounded-lg border border-primary p-3"
    >
      <p className="text-label font-semibold">{t("ask.title")}</p>
      <p>{question}</p>
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              disabled={disabled}
              onClick={() => {
                setPicked(true);
                onPick?.(c);
              }}
              className="h-8 rounded-full border border-primary px-3 text-label text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
      )}
      <p className="text-caption text-muted-foreground">{t("ask.hint")}</p>
    </section>
  );
}
