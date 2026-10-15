// CHAT-AC-57 · plan-frontend §4: phần trình bày dùng chung của hỏi lại — vùng (`region` tên = tiêu đề), câu hỏi, chip. Không fetch.
import type { ReactNode } from "react";

export function AskRegion({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-2 rounded-lg border border-primary p-3 text-sm"
    >
      <p className="text-label font-semibold">{title}</p>
      {children}
    </section>
  );
}

type BodyProps = {
  question: string;
  choices: readonly string[];
  /** Vắng ⇒ chip không bấm được (người chỉ xem). */
  onPick?: (choice: string) => void;
  disabled?: boolean;
  /** P-b: mô tả nguồn theo key (`title` của chip). */
  titles?: Readonly<Record<string, string>>;
};

export function AskBody({ question, choices, onPick, disabled, titles }: BodyProps) {
  return (
    <>
      {question && <p className="whitespace-pre-wrap wrap-anywhere">{question}</p>}
      {choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <button
              key={c}
              title={titles?.[c]}
              type="button"
              disabled={disabled || !onPick}
              onClick={() => onPick?.(c)}
              className="h-8 rounded-full border border-primary px-3 text-label text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
