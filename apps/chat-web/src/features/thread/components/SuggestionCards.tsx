// CHAT-AC-18 · 4 thẻ gợi ý trên trang chào: bấm → điền sẵn ô nhập (KHÔNG gửi).
import { useTranslation } from "react-i18next";

export const SUGGESTION_IDS = ["email", "summary", "translate", "outline"] as const;

export function SuggestionCards({ onPick }: { onPick(prompt: string): void }) {
  const { t } = useTranslation();
  return (
    <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
      {SUGGESTION_IDS.map((id) => {
        const prompt = t(`welcome.cards.${id}.prompt`);
        return (
          <button
            key={id}
            type="button"
            onClick={() => onPick(prompt)}
            className="rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <span className="block text-sm font-semibold text-foreground">
              {t(`welcome.cards.${id}.title`)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{prompt}</span>
          </button>
        );
      })}
    </div>
  );
}
