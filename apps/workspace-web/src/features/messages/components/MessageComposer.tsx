// CR-132 · W2/W3 · ô soạn tin: Enter gửi, Shift+Enter xuống dòng; nút ghim chọn tệp (tải lên ngay, hiện chip, gỡ được trước khi gửi).
// `lockedReason` ⇒ ô khoá kèm lý do (vd người kia đã khoá). Có tệp mà chưa có chữ vẫn gửi được; đang tải tệp ⇒ chờ.
import { type FileRef, MSG_BODY_MAX } from "@ai/contracts/pack-contracts";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconAttach, IconClose, IconSend } from "~/components/icons";
import { useStagedFiles } from "../hooks/use-staged-files";
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
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const pick = useRef<HTMLInputElement>(null);
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
      {staged.items.length > 0 && (
        <ul className="m-0 mb-1 flex list-none flex-wrap gap-1.5 p-0" data-testid="composer-files">
          {staged.items.map((f) => (
            <li
              key={f.key}
              className="flex max-w-full items-center gap-1 rounded-lg border border-rule bg-sunk px-2 py-1 text-label"
            >
              <span className="max-w-40 truncate">{f.name}</span>
              {f.status === "uploading" ? (
                <span className="text-micro text-dim">{t("contracts.messages.uploading")}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => staged.remove(f.key)}
                  aria-label={t("contracts.messages.removeFile", { name: f.name })}
                  className="grid h-5 w-5 place-items-center rounded text-dim hover:text-ink"
                >
                  <IconClose width={12} height={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-end gap-1 rounded-2xl border border-rule bg-panel focus-within:border-act-line">
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          accept={ATTACH_ACCEPT}
          data-testid="composer-file-input"
          onChange={(e) => {
            staged.add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => pick.current?.click()}
          aria-label={t("contracts.messages.attach")}
          title={t("contracts.messages.attach")}
          className="m-2 mr-0 grid h-8 w-8 shrink-0 place-items-center rounded-xl text-dim hover:bg-sunk hover:text-ink"
        >
          <IconAttach width={17} height={17} />
        </button>
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
          className="block max-h-40 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent px-2 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-dim"
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
