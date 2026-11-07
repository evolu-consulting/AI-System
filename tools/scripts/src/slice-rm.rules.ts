// Luật thuần của `slice:rm` và lời nhắn của `depcruise`.

/** `git worktree remove` báo thư mục không còn là worktree (đã gỡ/prune, chỉ còn thư mục thừa) ⇒ cứ xoá thư mục, không dừng. */
export function isNotWorktreeError(out: string): boolean {
  return /is not a working tree/i.test(out);
}

/** Dòng cuối khi depcruise đỏ: tách rõ vi phạm thật khỏi cảnh báo "stale known violations" (dòng cuối của depcruise hay bị nhầm là nguyên nhân). */
export function failNote(out: string): string | null {
  const m = /(\d+) dependency violations?\s*\((\d+) errors?/i.exec(out);
  const errors = m ? Number(m[2]) : 0;
  return errors > 0
    ? `depcruise: ĐỎ do ${errors} vi phạm thật ở trên (không phải do cảnh báo "stale known violations")`
    : null;
}
