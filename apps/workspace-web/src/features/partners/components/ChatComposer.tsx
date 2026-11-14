// CR-161 · lát 8 · ô soạn tin: chữ + «Đính kèm tệp» (tải lên ngay, ✕ bỏ, lỗi nói rõ) + «Gửi». Cùng hàng nút cùng cỡ, gap-2 (CR-163).
// Gửi lỗi ⇒ giữ nội dung và `client_id`; bấm «Gửi» lại dùng đúng id đó (máy chủ không nhân đôi). Sửa nội dung ⇒ id mới.
import { AttachDraftList } from "@ai/web-kit/ui/AttachDraft";
import { Paperclip, Send } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { ccFileUrl, errOf, useDraftFiles, useSendMessage } from "../hooks/use-cc-chat";
import { ATTACH_ACCEPT, type ChatErr, canSend } from "../lib/cc-chat";
import { chatAttachLabels } from "./chat-labels";

export function ChatComposer({ other }: { other: string }) {
  const { t, i18n } = useTranslation();
  const [text, setText] = useState("");
  const [err, setErr] = useState<ChatErr | null>(null);
  const clientId = useRef<string | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const send = useSendMessage(other);
  const explain = useCallback(
    (k: ChatErr, name: string) => t(`contracts.connect.chat.err.${k}`, { name }),
    [t],
  );
  const draft = useDraftFiles(other, explain);
  const fresh = () => {
    clientId.current = null;
    setErr(null);
  };
  const ok = canSend(text, draft.readyIds.length, draft.uploading) && !send.isPending;
  const submit = () => {
    if (!ok) return;
    clientId.current ??= crypto.randomUUID();
    send.mutate(
      { clientId: clientId.current, body: text.trim(), fileIds: draft.readyIds },
      {
        onSuccess: () => {
          setText("");
          draft.clear();
          fresh();
        },
        onError: (e) => setErr(errOf(e)),
      },
    );
  };
  return (
    <form
      className="flex flex-col gap-2 border-t border-rule pt-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <AttachDraftList
        items={draft.items}
        labels={chatAttachLabels(t)}
        onRemove={(id) => {
          draft.remove(id);
          fresh();
        }}
        onRetry={draft.retry}
        getUrl={ccFileUrl}
        locale={i18n.language}
        ariaLabel={t("contracts.connect.chat.file.drafts")}
      />
      <textarea
        aria-label={t("contracts.connect.chat.input")}
        placeholder={t("contracts.connect.chat.input")}
        value={text}
        maxLength={4000}
        rows={2}
        onChange={(e) => {
          setText(e.target.value);
          fresh();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
        }}
        className="block w-full resize-y rounded-lg border border-field bg-panel px-3 py-2 text-label"
      />
      {err && (
        <p role="alert" className="m-0 text-label text-late">
          {t(`contracts.connect.chat.err.${err}`, { name: "" })}
          {err === "failed" && ` ${t("contracts.connect.chat.retryHint")}`}
        </p>
      )}
      <div className="flex items-center gap-2">
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          accept={ATTACH_ACCEPT}
          data-testid="cc-file-input"
          onChange={(e) => {
            draft.add(Array.from(e.target.files ?? []));
            e.target.value = "";
            fresh();
          }}
        />
        <Btn variant="outline" onClick={() => pick.current?.click()}>
          <Paperclip className="size-4" aria-hidden="true" />
          {t("contracts.connect.chat.attach")}
        </Btn>
        <Btn type="submit" variant="primary" disabled={!ok} loading={send.isPending}>
          <Send className="size-4" aria-hidden="true" />
          {t("contracts.connect.chat.send")}
        </Btn>
      </div>
    </form>
  );
}
