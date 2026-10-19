// TK1 · đồng hồ giả + timer giả (Luật 4c: test không sleep). `FakeClock` trả `Date`; `FakeTimers` chạy callback khi `advance`.
export const T0 = new Date("2026-10-01T09:00:00.000Z");

export class FakeClock {
  private t: number;
  constructor(private readonly start: Date = T0) {
    this.t = start.getTime();
  }
  /** Dùng làm seam `now: () => Date`. */
  readonly now = (): Date => new Date(this.t);
  readonly ms = (): number => this.t;
  set(d: Date | number): void {
    this.t = typeof d === "number" ? d : d.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
  reset(): void {
    this.t = this.start.getTime();
  }
}

type Timer = { id: number; at: number; fn: () => void; every?: number };

/** setTimeout/setInterval điều khiển được; gắn vào `FakeClock` (advance của timers đẩy cả đồng hồ). */
export class FakeTimers {
  private timers: Timer[] = [];
  private seq = 0;
  constructor(readonly clock: FakeClock = new FakeClock()) {}

  readonly setTimeout = (fn: () => void, ms: number): number => this.add(fn, ms);
  readonly setInterval = (fn: () => void, ms: number): number => this.add(fn, ms, ms);
  readonly clear = (id: number): void => {
    this.timers = this.timers.filter((t) => t.id !== id);
  };
  get pending(): number {
    return this.timers.length;
  }
  private add(fn: () => void, ms: number, every?: number): number {
    const id = ++this.seq;
    this.timers.push({ id, at: this.clock.ms() + Math.max(0, ms), fn, every });
    return id;
  }

  /** Tiến `ms`: chạy mọi timer tới hạn theo thứ tự thời gian (rồi id); interval đặt lại. Trả số lần chạy. */
  advance(ms: number): number {
    const end = this.clock.ms() + ms;
    let ran = 0;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.clock.set(due.at);
      if (due.every === undefined) this.clear(due.id);
      else due.at += Math.max(1, due.every);
      due.fn();
      ran++;
    }
    this.clock.set(end);
    return ran;
  }
}
