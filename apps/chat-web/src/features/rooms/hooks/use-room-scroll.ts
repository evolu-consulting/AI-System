// HUB-FR-96 · cuộn dòng thời gian: bám đáy, tải trang cũ khi chạm đỉnh (giữ vị trí), đếm tin mới khi đang ở trên.
import {
  type MutableRefObject,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { isNearBottom } from "~/features/thread/lib/thread-logic";

const TOP_PX = 48;

type Anchor = { height: number; firstId: string | undefined } | null;

type Refs = {
  scroll: RefObject<HTMLDivElement>;
  content: RefObject<HTMLDivElement>;
  /** Đang bám đáy. */
  stick: MutableRefObject<boolean>;
  /** Neo trước khi tải trang cũ; khác `null` = đang giữ vị trí. */
  anchor: MutableRefObject<Anchor>;
};

/** Vào phòng ở đáy; về sau nội dung đổi cỡ (tin mới, tải xong) → bám đáy nếu đang bám và không giữ neo. */
function useFollowContent(r: Refs, ready: boolean): void {
  useEffect(() => {
    const content = r.content.current;
    if (!ready || !content) return;
    r.stick.current = true;
    const first = r.scroll.current;
    if (first) first.scrollTop = first.scrollHeight;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const el = r.scroll.current;
      if (el && r.stick.current && !r.anchor.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [r, ready]);
}

/** Trang cũ vừa chèn vào đầu: giữ nguyên vị trí đang đọc; tải xong mà tin đầu không đổi thì thả neo. */
function useKeepPosition(r: Refs, firstId: string | undefined, fetching: boolean): void {
  useLayoutEffect(() => {
    const a = r.anchor.current;
    const el = r.scroll.current;
    if (!a || !el || a.firstId === firstId) return;
    el.scrollTop += el.scrollHeight - a.height;
    r.anchor.current = null;
  }, [r, firstId]);
  useEffect(() => {
    if (!fetching) r.anchor.current = null;
  }, [r, fetching]);
}

type Args = {
  /** Id tin đầu tiên đang hiển thị (đổi khi trang cũ được thêm vào đầu). */
  firstId: string | undefined;
  /** Seq tin cuối; tăng ⇒ có tin mới. */
  lastSeq: number;
  loadOlder(): void;
  canLoadOlder: boolean;
  fetchingOlder: boolean;
  /** Khung cuộn đã dựng (dữ liệu đã tải). */
  ready: boolean;
};

export function useRoomScroll(a: Args) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const anchor = useRef<Anchor>(null);
  const refs = useRef<Refs>({ scroll: scrollRef, content: contentRef, stick, anchor }).current;
  const [atBottom, setAtBottom] = useState(true);
  const [seenSeq, setSeenSeq] = useState(a.lastSeq);
  const { firstId, lastSeq, loadOlder, canLoadOlder } = a;

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    stick.current = near;
    setAtBottom(near);
    if (el.scrollTop <= TOP_PX && canLoadOlder && !anchor.current) {
      anchor.current = { height: el.scrollHeight, firstId };
      loadOlder();
    }
  }, [canLoadOlder, firstId, loadOlder]);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    stick.current = true;
    setAtBottom(true);
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useFollowContent(refs, a.ready);
  useKeepPosition(refs, firstId, a.fetchingOlder);
  useEffect(() => {
    if (atBottom) setSeenSeq(lastSeq);
  }, [atBottom, lastSeq]);

  return { scrollRef, contentRef, onScroll, scrollToBottom, atBottom, seenSeq };
}
