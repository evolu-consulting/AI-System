// L1 (TECH-DEBT #224) · ADM-NFR-03 · semaphore trong tiến trình: trần số phép băm/verify mật khẩu chạy đồng thời
// (argon2id + scrypt tốn CPU) và trần hàng đợi — dồn dập vượt hàng đợi ⇒ từ chối ngay, không xếp vô hạn.
// Chờ bằng promise (slot được trao trực tiếp cho người kế), không poll, không hẹn giờ.

export class SemaphoreFullError extends Error {
  constructor() {
    super("semaphore queue full");
    this.name = "SemaphoreFullError";
  }
}

export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(
    readonly max: number,
    readonly maxQueue: number,
  ) {
    if (!Number.isInteger(max) || max < 1) throw new Error("semaphore max must be ≥ 1");
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error("semaphore maxQueue ≥ 0");
  }

  get stats(): { active: number; queued: number } {
    return { active: this.active, queued: this.waiting.length };
  }

  /** Chạy `fn` khi có slot. Hàng đợi đầy ⇒ ném `SemaphoreFullError` (đồng bộ trong promise, không chạy `fn`). */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    if (this.waiting.length >= this.maxQueue) return Promise.reject(new SemaphoreFullError());
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** Trao slot cho người chờ đầu (giữ `active`), không thì trả slot. */
  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }
}
