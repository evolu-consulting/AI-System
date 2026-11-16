// CR-178 · M3 · «Tìm trong cuộc trò chuyện»: ô tìm thay đầu khung chat, «2/5», ↑ (cũ hơn) ↓ (mới hơn), Enter / Shift+Enter, Esc đóng.
import type { MsgSearchHit } from "@ai/contracts/pack-contracts";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDebounced } from "../hooks/use-debounced";
import { canSearch, useMessageSearch } from "../hooks/use-find";
import { IconChevronDown, IconChevronLeft, IconChevronUp } from "../icons";
import { cycleIndex } from "../lib/find";

const iconBtn =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-dim hover:bg-sunk hover:text-ink disabled:opacity-40";

export function FindBar({
  conversationId,
  onJump,
  onClose,
}: {
  conversationId: string;
  onJump: (hit: MsgSearchHit) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 250);
  const s = useMessageSearch(dq, conversationId);
  const [idx, setIdx] = useState(0);
  const jumpRef = useRef(onJump);
  jumpRef.current = onJump;
  const first = s.items[0];
  // Từ khoá mới / kết quả đầu về ⇒ về kết quả mới nhất và nhảy tới đó.
  // biome-ignore lint/correctness/useExhaustiveDependencies: chạy theo từ khoá và tin khớp đầu tiên
  useEffect(() => {
    setIdx(0);
    if (first) jumpRef.current(first);
  }, [dq, first?.seq]);
  const n = s.items.length;
  // Gần hết kết quả đã tải mà còn trang ⇒ tải tiếp (để «n/…» đi tiếp được).
  useEffect(() => {
    if (s.hasNextPage && !s.isFetchingNextPage && idx >= n - 2) void s.fetchNextPage();
  }, [idx, n, s.hasNextPage, s.isFetchingNextPage, s.fetchNextPage]);
  const go = (dir: 1 | -1) => {
    if (n === 0) return;
    const i = cycleIndex(idx, n, dir);
    setIdx(i);
    const h = s.items[i];
    if (h) onJump(h);
  };
  const status = !canSearch(dq)
    ? ""
    : s.isPending
      ? t("contracts.messages.loadingMore")
      : n === 0
        ? t("contracts.messages.find.noneShort")
        : `${idx + 1}/${n}${s.hasNextPage ? "+" : ""}`;
  return (
    <header
      data-testid="find-bar"
      className="flex h-14 shrink-0 items-center gap-2 border-b border-rule-soft px-3"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={t("contracts.messages.find.close")}
        title={t("contracts.messages.find.close")}
        data-testid="find-close"
        className={iconBtn}
      >
        <IconChevronLeft width={18} height={18} />
      </button>
      <Input
        autoFocus
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          else if (e.key === "Enter") {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
        }}
        placeholder={t("contracts.messages.find.inChat")}
        aria-label={t("contracts.messages.find.inChat")}
        data-testid="find-input"
        className="min-w-0 flex-1"
      />
      <span
        className="min-w-10 shrink-0 text-center text-micro text-dim"
        data-testid="find-count"
        aria-live="polite"
      >
        {status}
      </span>
      <button
        type="button"
        disabled={n === 0}
        onClick={() => go(1)}
        aria-label={t("contracts.messages.find.older")}
        title={t("contracts.messages.find.older")}
        data-testid="find-up"
        className={iconBtn}
      >
        <IconChevronUp width={18} height={18} />
      </button>
      <button
        type="button"
        disabled={n === 0}
        onClick={() => go(-1)}
        aria-label={t("contracts.messages.find.newer")}
        title={t("contracts.messages.find.newer")}
        data-testid="find-down"
        className={iconBtn}
      >
        <IconChevronDown width={18} height={18} />
      </button>
    </header>
  );
}
