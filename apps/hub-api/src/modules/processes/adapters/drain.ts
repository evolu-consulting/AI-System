// HUB-FR-143 · Luật 4c · test-plan-addendum §4 (qc TC) · T7: tín hiệu "Hub đã xử lý xong kết quả job đã nhận" — đếm việc
// stage-driver đang chạy (từ lúc nhận kết quả job tới khi xong tx + `finish` + `kick`). `settled()` trả promise resolve
// khi bộ đếm về 0 (không timer, không poll). Một bộ đếm mỗi mount (`ProcessDeps.drain`).

export class DrainTracker {
  #busy = 0;
  #waiters: (() => void)[] = [];

  /** Chạy `fn` trong lúc đếm (kể cả khi `fn` ném); trả nguyên kết quả/lỗi của `fn`. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    this.#busy++;
    try {
      return await fn();
    } finally {
      this.#busy--;
      if (this.#busy === 0) this.#wake();
    }
  }

  /** Resolve khi không còn việc đang xử lý (ngay lập tức nếu đang rảnh). */
  settled(): Promise<void> {
    if (this.#busy === 0) return Promise.resolve();
    return new Promise((resolve) => this.#waiters.push(resolve));
  }

  #wake(): void {
    const ws = this.#waiters;
    this.#waiters = [];
    for (const w of ws) w();
  }
}
