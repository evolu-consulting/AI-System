// M2-chat · ô hỏi của khoang trợ lý (như mgmt-app): textarea tự cao, Enter gửi / Shift+Enter xuống dòng, nút Gửi; đang trả lời
// ⇒ nút thành Dừng. Chưa đính kèm tệp ở M2 (để sau).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconClose, IconSend } from "~/components/icons";
import { QUESTION_MAX } from "../lib/chat.rules";

export function Composer({
  busy,
  onSend,
  onStop,
  placeholder,
}: {
  busy: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cao theo nội dung mỗi lần gõ
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  const canSend = !busy && text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(text);
    setText("");
  };
  return (
    <form
      className="shrink-0 px-3 pt-1 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="rounded-2xl border border-rule bg-panel shadow-[0_2px_12px_rgba(20,20,60,0.06)] focus-within:border-act-line">
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={QUESTION_MAX}
          placeholder={placeholder ?? t("contracts.assistant.placeholder")}
          aria-label={t("contracts.assistant.question")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="block max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[13.5px] leading-relaxed outline-none placeholder:text-dim"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <span className="ml-1 text-[11px] text-dim max-xl:hidden">
            {t("contracts.assistant.enterHint")}
          </span>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              aria-label={t("contracts.assistant.stop")}
              className="ml-auto grid h-8 w-8 place-items-center rounded-xl border border-rule text-dim hover:text-ink"
            >
              <IconClose width={16} height={16} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label={t("contracts.assistant.send")}
              className="ml-auto grid h-8 w-8 place-items-center rounded-xl bg-act text-on-act hover:bg-act-hover active:scale-95 disabled:opacity-35"
            >
              <IconSend width={17} height={17} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
