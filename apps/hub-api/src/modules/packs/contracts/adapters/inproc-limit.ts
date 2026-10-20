// TD #242 (review an ninh N-7) · semaphore cho job trích chạy TRONG TIẾN TRÌNH (Redis sập ⇒ `withFallback`; vắng Redis ⇒ chạy
// ngay): trước đây không giới hạn đồng thời ⇒ một loạt upload lúc Redis down mở N lượt AI + PDF song song trong hub-api.
// Quá giới hạn thì XẾP HÀNG (FIFO, không bỏ job — HĐ vẫn `extracting`, vòng quét STALE là lưới an toàn). Không sleep/poll:
// job xong thì đánh thức đúng người kế tiếp.
/** Mặc định = số worker của luồng Redis (`ContractsAiDeps.concurrency ?? 2`). */
export const INPROC_DEFAULT_CONCURRENCY = 2;

export type InprocLimiter = {
  /** Chạy `fn` khi còn chỗ; trả khi `fn` xong (lỗi của `fn` không làm kẹt chỗ, không ném ra ngoài — gọi `onError`). */
  run(fn: () => Promise<void>): Promise<void>;
  readonly running: number;
  readonly waiting: number;
};

export function createInprocLimiter(
  max: number,
  onError: (err: unknown) => void = () => undefined,
): InprocLimiter {
  const cap = Math.max(1, Math.floor(max) || 1);
  let running = 0;
  const queue: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (running < cap) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => queue.push(resolve)); // chỗ được chuyển thẳng cho người đợi (running giữ nguyên)
  };
  const release = (): void => {
    const next = queue.shift();
    if (next) next();
    else running--;
  };
  return {
    async run(fn) {
      await acquire();
      try {
        await fn();
      } catch (err) {
        onError(err);
      } finally {
        release();
      }
    },
    get running() {
      return running;
    },
    get waiting() {
      return queue.length;
    },
  };
}
