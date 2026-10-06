// CHAT-AC-05, CHAT-AC-10, HUB-FR-10 · ô nhập: tự giãn ≤ 8 dòng, Enter gửi / Shift+Enter xuống dòng, Gửi↔Dừng, Esc dừng, khoá khi run khác chạy, nháp localStorage, menu `/` (gõ `/` ở đầu tin; `//` không mở), menu `@` (`@@` không mở), lỗi `CMD_*`/`AGENT_NOT_FOUND`/429 (đếm ngược) ngay trong ô.
// Dùng lại cho ô chính (F7/F8) và khung flow (F10): khác nhau ở `variant`, `draftKey`, `onSubmit`.

import type { TFunction } from "i18next";
import { ArrowUp, Square } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { AttachButton } from "~/features/attachments/components/AttachButton";
import { AttachBar } from "~/features/attachments/components/AttachmentChip";
import { useAttachments } from "~/features/attachments/hooks/use-attachments";
import { composerKeyHandler } from "../hooks/use-composer-keys";
import { readDraft, useDraftSaver } from "../hooks/use-draft";
import { type SubmitResult, useSendError } from "../hooks/use-send-error";
import { useComposerSuggest } from "../hooks/use-suggest";
import { COMPOSER_MAX_ROWS, canSend, clampHeight, submitOutcome } from "../lib/composer-logic";
import { AgentMenu } from "./AgentMenu";
import { CommandMenu } from "./CommandMenu";
import { QuotaNotice } from "./QuotaNotice";
import { SendErrorNotice } from "./SendErrorNotice";

/** Tooltip nút Gửi khi bị khoá. */
function sendTitle(t: TFunction, locked: boolean, uploading: boolean): string | undefined {
  if (locked) return t("composer.busy");
  return uploading ? t("attach.waitUpload") : undefined;
}

// Render server (bun test) không có layout effect.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Kiểu ở hook (component không import `~/lib/http` — depcruise component-no-fetch); giữ export cho nơi dùng cũ.
export type { SubmitResult };

export type ComposerHandle = {
  /** Điền sẵn (thẻ gợi ý): thay nội dung, focus, con trỏ cuối, KHÔNG gửi. */
  fill(text: string): void;
  focus(): void;
};

export type ComposerProps = {
  variant: "main" | "flow";
  /** `draftKey(convId, flowId)`. */
  draftKey: string;
  /** Run khác đang chạy trong hội thoại: gõ được, Gửi disabled + tooltip `composer.busy` (UC-02). */
  locked?: boolean;
  /** Run của composer này đang chạy: nút Gửi thành Dừng, Esc dừng. */
  running?: boolean;
  /** `run.started.quota.state = over`. */
  quotaOver?: boolean;
  autoFocus?: boolean;
  onSubmit(text: string, attachmentIds?: string[]): Promise<SubmitResult>;
  onStop?(): void;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    variant,
    draftKey,
    locked = false,
    running = false,
    quotaOver = false,
    autoFocus,
    onSubmit,
    onStop,
  },
  ref,
) {
  const { t } = useTranslation();
  const [text, setText] = useState(() => readDraft(draftKey));
  const [submitting, setSubmitting] = useState(false);
  const [caret, setCaret] = useState(() => text.length);
  const area = useRef<HTMLTextAreaElement>(null);
  const draft = useDraftSaver(draftKey);
  const flow = variant === "flow";

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  useIsoLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.style.height = `${clampHeight(el.scrollHeight, line, COMPOSER_MAX_ROWS)}px`;
    el.style.overflowY = el.scrollHeight > line * COMPOSER_MAX_ROWS ? "auto" : "hidden";
  }, [text]);

  const {
    command: cmdSuggest,
    agent: agentSuggest,
    current: suggest,
    aria,
  } = useComposerSuggest(text, caret);
  const sendError = useSendError(text);
  const att = useAttachments();
  const { clear: clearSendError } = sendError;
  const change = useCallback(
    (value: string, nextCaret = value.length) => {
      setText(value);
      setCaret(nextCaret);
      clearSendError();
      draft.save(value);
    },
    [draft, clearSendError],
  );

  useImperativeHandle(
    ref,
    () => ({
      fill(value) {
        change(value);
        const el = area.current;
        if (!el) return;
        el.focus();
        requestAnimationFrame(() => el.setSelectionRange(value.length, value.length));
      },
      focus: () => area.current?.focus(),
    }),
    [change],
  );

  const send = useCallback(async () => {
    if (!canSend(text, locked, submitting) || sendError.cooling || att.busy) return;
    setSubmitting(true);
    try {
      const sent = text.trim();
      const r = await onSubmit(sent, att.ids);
      const out = submitOutcome(r);
      if (out.kind === "sent") {
        draft.clear();
        setText("");
        setCaret(0);
        sendError.clear();
        att.clear();
      } else if (out.kind === "error") {
        sendError.set(out.error, sent);
        att.onSendError(out.error);
      }
    } finally {
      setSubmitting(false);
    }
  }, [text, locked, submitting, onSubmit, draft, sendError, att]);

  const pickCommand = useCallback(
    (index?: number) => {
      const r = suggest.pick(text, index);
      if (!r) return;
      change(r.text, r.caret);
      const el = area.current;
      el?.focus();
      requestAnimationFrame(() => el?.setSelectionRange(r.caret, r.caret));
    },
    [suggest, text, change],
  );

  const onKeyDown = composerKeyHandler({
    suggest,
    running,
    pickCommand: () => pickCommand(),
    send: () => void send(),
    stop: onStop,
  });

  const enabled = canSend(text, locked, submitting) && !sendError.cooling && !att.busy;
  const errorView = sendError.view;
  return (
    <div className="w-full">
      <QuotaNotice over={quotaOver} />
      {errorView && (
        <SendErrorNotice
          view={errorView}
          onPick={(name) => {
            const el = area.current;
            change(sendError.applySuggestion(name));
            el?.focus();
          }}
        />
      )}
      {cmdSuggest.open && <CommandMenu suggest={cmdSuggest} onPick={pickCommand} />}
      {agentSuggest.open && <AgentMenu suggest={agentSuggest} onPick={pickCommand} />}
      {variant === "main" && (
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{t("composer.newLabel")}</span>
          {" · "}
          {t("composer.newHint")}
        </p>
      )}
      <AttachBar chips={att.chips} onRemove={att.remove} onRetry={att.retry} />
      <div
        {...att.dropProps}
        className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50"
      >
        <AttachButton onPick={att.add} />
        {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: plan-frontend §1.1 cần aria-expanded; giữ role textbox vì e2e chọn textbox "Tin nhắn". */}
        <textarea
          ref={area}
          rows={1}
          value={text}
          aria-label={t(flow ? "composer.flowInput" : "composer.input")}
          placeholder={t(flow ? "composer.flowPlaceholder" : "composer.placeholder")}
          aria-expanded={aria.expanded}
          aria-controls={aria.controls}
          aria-activedescendant={aria.activeDescendant}
          onChange={(e) => change(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="max-h-none min-h-6 flex-1 resize-none bg-transparent px-2 py-1 text-sm leading-6 outline-none placeholder:text-placeholder"
        />
        {running ? (
          <Button type="button" size="icon" aria-label={t("composer.stop")} onClick={onStop}>
            <Square className="size-4 fill-current" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            aria-label={t(flow ? "composer.sendInFlow" : "composer.send")}
            title={sendTitle(t, locked, att.busy)}
            disabled={!enabled}
            onClick={() => void send()}
          >
            <ArrowUp className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
});
