// CR-132 · W2 · ô soạn tin: Enter gửi, Shift+Enter xuống dòng (cùng kiểu ô hỏi trợ lý). Nút đính kèm CHƯA có (M5 làm sau) ⇒ không hiện,
// không để nút chết. `locked` ⇒ ô khoá kèm lý do (vd người kia đã khoá).
import { MSG_BODY_MAX } from "@ai/contracts/pack-contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconSend } from "~/components/icons";

export function MessageComposer({
  onSend,
  lockedReason,
}: {
  onSend: (body: string) => void;
  lockedReason: string | null;
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
  if (lockedReason)
    return (
      <p
        role="status"
        data-testid="composer-locked"
        className="m-0 shrink-0 border-t border-rule bg-sunk px-4 py-3 text-label text-dim"
      >
        {lockedReason}
      </p>
    );
  const canSend = text.trim().length > 0;
  const send = () => {
    if (!canSend) return;
    onSend(text.trim());
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
      <div className="flex items-end gap-2 rounded-2xl border border-rule bg-panel focus-within:border-act-line">
        <textarea
          ref={box}
          rows={1}
          value={text}
          maxLength={MSG_BODY_MAX}
          placeholder={t("contracts.messages.placeholder")}
          aria-label={t("contracts.messages.composer")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="block max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-3.5 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-dim"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("contracts.messages.send")}
          className="m-2 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-act text-on-act hover:bg-act-hover active:scale-95 disabled:opacity-35"
        >
          <IconSend width={17} height={17} strokeWidth={2.2} />
        </button>
      </div>
    </form>
  );
}
