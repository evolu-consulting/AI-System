// CHAT-AC-05, CHAT-AC-10, HUB-FR-10 · ô nhập: tự giãn ≤ 8 dòng, Enter gửi / Shift+Enter xuống dòng, Gửi↔Dừng, Esc dừng, khoá khi run khác chạy, nháp localStorage, menu `/` (gõ `/` ở đầu tin; `//` không mở), menu `@` (`@@` không mở), lỗi `CMD_*`/`AGENT_NOT_FOUND`/429 (đếm ngược) ngay trong ô.
// Dùng lại cho ô chính (F7/F8) và khung flow (F10): khác nhau ở `variant`, `draftKey`, `onSubmit`.
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
import { AttachBar } from "~/features/attachments/components/AttachmentChip";
import { useAttachments } from "~/features/attachments/hooks/use-attachments";
import { composerKeyHandler } from "../hooks/use-composer-keys";
import { readDraft, useDraftSaver } from "../hooks/use-draft";
import { useSendError } from "../hooks/use-send-error";
import { useComposerSuggest } from "../hooks/use-suggest";
import {
  COMPOSER_MAX_ROWS,
  canSend,
  clampHeight,
  inputLabels,
  overLimit,
  submitOutcome,
} from "../lib/composer-logic";
import { AgentMenu } from "./AgentMenu";
import { CharCount } from "./CharCount";
import { CommandMenu } from "./CommandMenu";
import { ComposerRow, sendTitle } from "./ComposerRow";
import type { ComposerHandle, ComposerProps } from "./composer-types";
import { QuotaNotice } from "./QuotaNotice";
import { SendErrorNotice } from "./SendErrorNotice";

// Render server (bun test) không có layout effect.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type { ComposerHandle, ComposerProps, SubmitResult } from "./composer-types";

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    variant,
    draftKey,
    locked = false,
    running = false,
    quotaOver = false,
    autoFocus,
    menus = true,
    attachments = true,
    inputLabel,
    placeholder,
    menuTitle,
    hint,
    maxChars,
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
  } = useComposerSuggest(text, caret, menus);
  const sendError = useSendError(text);
  const att = useAttachments();
  const over = overLimit(text, maxChars);
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
    if (!canSend(text, locked, submitting) || over || sendError.cooling || att.busy) return;
    setSubmitting(true);
    try {
      const sent = text.trim();
      const r = await onSubmit(sent, attachments ? att.ids : undefined);
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
  }, [text, locked, submitting, over, onSubmit, draft, sendError, att, attachments]);

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

  const enabled = canSend(text, locked, submitting) && !over && !sendError.cooling && !att.busy;
  const errorView = sendError.view;
  const labels = inputLabels(t, flow, inputLabel, placeholder);
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
      {agentSuggest.open && (
        <AgentMenu suggest={agentSuggest} onPick={pickCommand} title={menuTitle} />
      )}
      {variant === "main" && (
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{t("composer.newLabel")}</span>
          {" · "}
          {t("composer.newHint")}
        </p>
      )}
      {attachments && <AttachBar chips={att.chips} onRemove={att.remove} onRetry={att.retry} />}
      <ComposerRow
        areaRef={area}
        text={text}
        labels={labels}
        aria={aria}
        flow={flow}
        running={running}
        enabled={enabled}
        sendTitle={sendTitle(t, locked, att.busy)}
        attach={attachments ? { add: att.add, dropProps: att.dropProps } : null}
        onChange={change}
        onCaret={setCaret}
        onKeyDown={onKeyDown}
        onSend={() => void send()}
        onStop={onStop}
      />
      {hint && <p className="mt-1 px-1 text-xs text-muted-foreground">{hint}</p>}
      {maxChars !== undefined && <CharCount length={text.length} max={maxChars} />}
    </div>
  );
});
