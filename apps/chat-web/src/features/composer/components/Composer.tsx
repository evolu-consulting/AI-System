// CHAT-AC-05, CHAT-AC-10, HUB-FR-10 · ô nhập: tự giãn ≤ 8 dòng, Enter gửi / Shift+Enter xuống dòng, Gửi↔Dừng, Esc dừng, khoá khi run khác chạy, nháp localStorage, menu `/` (gõ `/` ở đầu tin; `//` không mở), lỗi `CMD_*` ngay trong ô.
// Dùng lại cho ô chính (F7/F8) và khung flow (F10): khác nhau ở `variant`, `draftKey`, `onSubmit`.
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
import { replaceCommandName } from "~/features/commands/lib/slash";
import type { ApiError } from "~/lib/http";
import { composerKeyHandler } from "../hooks/use-composer-keys";
import { readDraft, useDraftSaver } from "../hooks/use-draft";
import { useCommandSuggest } from "../hooks/use-suggest";
import { COMPOSER_MAX_ROWS, canSend, clampHeight, submitOutcome } from "../lib/composer-logic";
import { sendErrorView } from "../lib/send-error";
import { COMMAND_MENU_ID, CommandMenu } from "./CommandMenu";
import { QuotaNotice } from "./QuotaNotice";
import { SendErrorNotice } from "./SendErrorNotice";
import { optionId } from "./SuggestMenu";

// Render server (bun test) không có layout effect.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** `true`/`{ok:true}` = đã gửi (xoá chữ + nháp); `false` giữ chữ; `{ok:false,error}` giữ chữ, mã `CMD_*` hiện trong ô. */
export type SubmitResult = boolean | { ok: true } | { ok: false; error: ApiError };

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
  onSubmit(text: string): Promise<SubmitResult>;
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
  const [sendError, setSendError] = useState<{ error: ApiError; text: string } | null>(null);
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

  const suggest = useCommandSuggest(text, caret);
  const change = useCallback(
    (value: string, nextCaret = value.length) => {
      setText(value);
      setCaret(nextCaret);
      setSendError(null);
      draft.save(value);
    },
    [draft],
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
    if (!canSend(text, locked, submitting)) return;
    setSubmitting(true);
    try {
      const sent = text.trim();
      const r = await onSubmit(sent);
      const out = submitOutcome(r);
      if (out.kind === "sent") {
        draft.clear();
        setText("");
        setCaret(0);
        setSendError(null);
      } else if (out.kind === "error") {
        setSendError({ error: out.error, text: sent });
      }
    } finally {
      setSubmitting(false);
    }
  }, [text, locked, submitting, onSubmit, draft]);

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

  const enabled = canSend(text, locked, submitting);
  const errorView = sendError ? sendErrorView(sendError.error, sendError.text) : null;
  const showMenu = suggest.open;
  return (
    <div className="w-full">
      <QuotaNotice over={quotaOver} />
      {errorView && (
        <SendErrorNotice
          view={errorView}
          onPick={(name) => {
            const base = sendError?.text ?? text;
            const el = area.current;
            change(replaceCommandName(base, name));
            el?.focus();
          }}
        />
      )}
      {suggest.open && <CommandMenu suggest={suggest} onPick={pickCommand} />}
      {variant === "main" && (
        <p className="mb-1 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{t("composer.newLabel")}</span>
          {" · "}
          {t("composer.newHint")}
        </p>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <textarea
          ref={area}
          rows={1}
          value={text}
          aria-label={t(flow ? "composer.flowInput" : "composer.input")}
          placeholder={t(flow ? "composer.flowPlaceholder" : "composer.placeholder")}
          aria-controls={showMenu ? COMMAND_MENU_ID : undefined}
          aria-activedescendant={
            showMenu && suggest.matches.length > 0
              ? optionId(COMMAND_MENU_ID, suggest.active)
              : undefined
          }
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
            title={locked ? t("composer.busy") : undefined}
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
