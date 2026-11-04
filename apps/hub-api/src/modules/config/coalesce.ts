// HUB-FR-02 · gộp lần gọi chồng nhau của vòng nạp ConfigCache (tách khỏi config.service.ts cho ≤ 400 dòng).
/** Gộp các lần gọi chồng nhau: đang chạy thì đánh dấu chạy lại một lần nữa sau khi xong. */
export type Coalesced = (() => Promise<void>) & { current(): Promise<void> | null };
export function coalesce(fn: () => Promise<void>): Coalesced {
  let running: Promise<void> | null = null;
  let again = false;
  const call = () => {
    if (running) {
      again = true;
      return running;
    }
    const loop = async (): Promise<void> => {
      do {
        again = false;
        await fn();
      } while (again);
    };
    running = loop().finally(() => {
      running = null;
    });
    return running;
  };
  return Object.assign(call, { current: () => running });
}
