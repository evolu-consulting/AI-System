// Ô viết bình luận có nhắc tên «@» (CR-129): gõ `@` ⇒ popover gợi ý công ty (gọi `mentionables`), ↑↓ chọn, Enter chèn, Esc đóng.
// Gợi ý rỗng (đối tác) ⇒ không bật popover và không gọi lại. Enter khi không có popover ⇒ gửi.
import type { Mention } from "@ai/contracts/community";
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { activeMention, insertMention, moveIndex } from "../domain/thread";
import { t } from "../i18n";

export function MentionBox({
  text,
  onText,
  picked,
  onPick,
  fetchOptions,
  onSubmit,
}: {
  text: string;
  onText: (v: string) => void;
  picked: Mention[];
  onPick: (m: Mention) => void;
  fetchOptions: (q: string) => Promise<Mention[]>;
  onSubmit: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const noneAvailable = useRef(false);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [options, setOptions] = useState<Mention[]>([]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const am = dismissed ? null : activeMention(text, caret);
  const query = am?.query;

  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ tải lại khi chữ đang gõ sau @ đổi
  useEffect(() => {
    if (query === undefined || noneAvailable.current) {
      setOptions([]);
      return;
    }
    const mine = ++seq.current;
    fetchOptions(query).then(
      (r) => {
        if (mine !== seq.current) return; // kết quả cũ
        if (query === "" && r.length === 0) noneAvailable.current = true;
        setOptions(r);
        setIdx(0);
      },
      () => mine === seq.current && setOptions([]),
    );
  }, [query]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy sau mỗi lần chữ đổi để áp con trỏ chờ sẵn
  useLayoutEffect(() => {
    const c = pendingCaret.current;
    if (c === null) return;
    pendingCaret.current = null;
    input.current?.focus();
    input.current?.setSelectionRange(c, c);
  }, [text]);

  const open = am !== null && options.length > 0;
  const choose = (m: Mention) => {
    if (!am) return;
    const r = insertMention(text, am.start, caret, m.name);
    onText(r.text);
    onPick(m);
    setCaret(r.caret);
    setOptions([]);
    pendingCaret.current = r.caret; // áp ở useLayoutEffect ngay sau khi chữ mới lên DOM (không chờ khung hình)
  };
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một bộ xử lý phím cho popover (↑↓ Enter Tab Esc)
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setIdx(moveIndex(idx, e.key === "ArrowDown" ? 1 : -1, options.length));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const m = options[idx];
        if (m) choose(m);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (e.key === "Enter") onSubmit();
  };
  const sync = (el: HTMLInputElement) => setCaret(el.selectionStart ?? el.value.length);
  const listId = "mention-list";
  return (
    <div className="mentionbox">
      {open && (
        <div
          id={listId}
          className="mentionpop"
          role="listbox"
          aria-label={t("community.thread.mentionList")}
          data-testid="mention-popover"
        >
          {options.map((m, i) => (
            <div
              key={m.orgId}
              role="option"
              tabIndex={-1}
              aria-selected={i === idx}
              className={i === idx ? "mentionopt on" : "mentionopt"}
              data-testid="mention-option"
              onMouseDown={(e) => {
                e.preventDefault(); // giữ focus ở ô nhập
                choose(m);
              }}
            >
              {m.name}
            </div>
          ))}
        </div>
      )}
      <input
        ref={input}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        aria-label={t("community.thread.writeComment")}
        placeholder={t("community.thread.writeCommentPlaceholder")}
        value={text}
        onChange={(e) => {
          setDismissed(false);
          onText(e.target.value);
          sync(e.target);
        }}
        onKeyDown={onKey}
        onKeyUp={(e) => !["ArrowUp", "ArrowDown", "Enter"].includes(e.key) && sync(e.currentTarget)}
        onClick={(e) => sync(e.currentTarget)}
      />
      {picked.some((m) => text.includes(`@${m.name}`)) && (
        <div className="mentionhint" data-testid="mention-hint">
          {t("community.thread.mentionHint")}
        </div>
      )}
    </div>
  );
}
