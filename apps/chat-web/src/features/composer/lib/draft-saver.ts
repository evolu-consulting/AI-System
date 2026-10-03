// CHAT-AC-05 · ghi nháp có debounce, không phụ thuộc React. `canWrite()` false (phiên đã kết thúc) → bỏ nháp chờ ghi,
// vì đăng xuất đã xoá `chat:draft:*` và không được ghi lại dưới khoá của user cũ (TECH-DEBT #40).
export type DraftSaverDeps = {
  write(key: string, value: string): void;
  remove(key: string): void;
  canWrite(): boolean;
  setTimer(cb: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
};

export function createDraftSaver(key: string, debounceMs: number, deps: DraftSaverDeps) {
  let timer: unknown;
  let pending: string | null = null;
  const flush = () => {
    deps.clearTimer(timer);
    const text = pending;
    pending = null;
    if (text === null || !deps.canWrite()) return;
    if (text === "") deps.remove(key);
    else deps.write(key, text);
  };
  return {
    flush,
    save(text: string) {
      pending = text;
      deps.clearTimer(timer);
      timer = deps.setTimer(flush, debounceMs);
    },
    clear() {
      deps.clearTimer(timer);
      pending = null;
      deps.remove(key);
    },
  };
}
