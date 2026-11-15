// CR-132 · W2/W3 · ô soạn tin: Enter gửi, Shift+Enter xuống dòng; nút ghim chọn tệp (tải lên ngay, hiện chip, gỡ được trước khi gửi).
// `lockedReason` ⇒ ô khoá kèm lý do (vd người kia đã khoá). Có tệp mà chưa có chữ vẫn gửi được; đang tải tệp ⇒ chờ.
import { type FileRef, MSG_BODY_MAX } from "@ai/contracts/pack-contracts";
import { attachPickLabels } from "@ai/web-kit/attach-layout";
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { AttachPickButton } from "@ai/web-kit/ui/AttachDropzone";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStagedFiles } from "../hooks/use-staged-files";
import { IconSend } from "../icons";
import { attachLabels, toDraftItem } from "../lib/attach-view";
import { ATTACH_ACCEPT } from "../lib/files";

export function MessageComposer({
  conversationId,
  onSend,
  lockedReason,
}: {
  conversationId: string;
  onSend: (body: string, files: readonly FileRef[]) => void;
  lockedReason: string | null;
}) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const staged = useStagedFiles(conversationId);
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
  const canSend = !staged.busy && (text.trim().length > 0 || staged.ready.length > 0);
  const send = () => {
    if (!canSend) return;
    onSend(text.trim(), staged.ready);
    setText("");
    staged.clear();
  };
  return (
    <form
      className="shrink-0 px-3 pt-1 pb-3"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {staged.error && (
        <p role="alert" data-testid="composer-file-error" className="m-0 mb-1 text-label text-late">
          {t(staged.error)}
        </p>
      )}
      <div className="mb-1">
        <AttachDraftList
          items={staged.items.map(toDraftItem)}
          labels={attachLabels(t)}
          ariaLabel={t("contracts.messages.stagedFiles")}
          compact
          onRemove={staged.remove}
          locale={i18n.language}
        />
      </div>
      <div className="flex items-center gap-1 rounded-2xl border border-rule bg-panel focus-within:border-act-line">
        <AttachPickButton
          labels={attachPickLabels(t, "contracts.messages.attachPick")}
          accept={ATTACH_ACCEPT}
          check={false}
          inputTestId="composer-file-input"
          onFiles={staged.add}
          className="my-0 ml-2 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-dim hover:bg-sunk hover:text-ink"
        />
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
          className="block max-h-40 min-h-12 min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-dim"
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={t("contracts.messages.send")}
          className="my-0 mr-2 grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-act text-on-act hover:bg-act-hover active:scale-95 disabled:opacity-35"
        >
          <IconSend width={17} height={17} strokeWidth={2.2} />
        </button>
      </div>
    </form>
  );
}
