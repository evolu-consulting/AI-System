// HUB-FR-100 · đánh dấu đã đọc khi phòng mở ∧ tab hiện ∧ ở đáy ∧ seq mới; throttle 1 lần/giây (plan-frontend §3).
import { useEffect, useRef, useState } from "react";
import { createMarkReadGate, type MarkReadGate } from "../lib/mark-read-gate";
import { useMarkRoomRead } from "./use-room-actions";

const INTERVAL_MS = 1000;

export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return visible;
}

type Args = {
  roomId: string;
  /** Seq lớn nhất đang hiển thị. */
  lastSeq: number;
  atBottom: boolean;
  /** Tin cuối là của tôi: server đã tự đọc (R18), không gọi. */
  lastIsMine: boolean;
};

export function useMarkRead({ roomId, lastSeq, atBottom, lastIsMine }: Args): void {
  const mark = useMarkRoomRead(roomId);
  const send = useRef(mark.mutateAsync);
  send.current = mark.mutateAsync;
  const gate = useRef<MarkReadGate | null>(null);
  const visible = useTabVisible();

  useEffect(() => {
    const g = createMarkReadGate({
      send: (seq) => send.current(seq),
      now: () => Date.now(),
      setTimer: (cb, ms) => {
        const t = setTimeout(cb, ms);
        return () => clearTimeout(t);
      },
      intervalMs: INTERVAL_MS,
    });
    gate.current = g;
    return () => {
      g.dispose();
      gate.current = null;
    };
  }, []);

  useEffect(() => {
    if (visible && atBottom && !lastIsMine && lastSeq > 0) gate.current?.offer(lastSeq);
  }, [visible, atBottom, lastIsMine, lastSeq]);
}
