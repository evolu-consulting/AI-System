// HUB-FR-100 · cổng đánh dấu đã đọc: chỉ gửi seq mới hơn mốc đã gửi, tối đa 1 lần/`intervalMs`, gộp trailing (plan-frontend §3).
export type MarkReadDeps = {
  send(seq: number): Promise<unknown>;
  now(): number;
  setTimer(cb: () => void, ms: number): () => void;
  intervalMs: number;
};

export type MarkReadGate = { offer(seq: number): void; dispose(): void };

export function createMarkReadGate(deps: MarkReadDeps): MarkReadGate {
  let sentSeq = 0;
  let lastAt = Number.NEGATIVE_INFINITY;
  let pending = 0;
  let cancel: (() => void) | null = null;
  let disposed = false;

  const fire = (seq: number, isRetry = false) => {
    const prev = sentSeq;
    sentSeq = seq;
    lastAt = deps.now();
    deps.send(seq).catch(() => {
      if (disposed || sentSeq !== seq) return;
      sentSeq = prev; // lỗi: cho phép thử lại ở lần offer kế
      if (isRetry || cancel) return;
      // Hẹn thử lại đúng seq này một lần sau `intervalMs` (lần đọc cuối không bị kẹt chưa đọc).
      cancel = deps.setTimer(() => {
        cancel = null;
        if (disposed) return;
        const s = Math.max(seq, pending);
        pending = 0;
        if (s > sentSeq) fire(s, true);
      }, deps.intervalMs);
    });
  };

  return {
    offer(seq) {
      if (disposed) return;
      if (seq <= sentSeq || seq <= pending) return;
      const wait = lastAt + deps.intervalMs - deps.now();
      if (wait <= 0) return fire(seq);
      pending = seq;
      if (cancel) return;
      cancel = deps.setTimer(() => {
        cancel = null;
        if (disposed) return;
        const s = pending;
        pending = 0;
        if (s > sentSeq) fire(s);
      }, wait);
    },
    dispose() {
      disposed = true;
      cancel?.();
      cancel = null;
      pending = 0;
    },
  };
}
