// WRK-FR-03 · H2b-R24 · P14 · `job.delta{kind:"done"}` tổng hợp cho agent Dify do Hub gọi khi job được stream: mỗi mẩu
// chữ Dify (≤ `JOB_DELTA_TEXT_MAX`) thành một sự kiện, `seq` liền mạch sau `job.started` (1) — cùng đường chuyển tiếp
// `DeltaSink` với job Runtime (P11). Sự kiện được phát ra **trong lúc** Dify còn chạy (generator chờ lời gọi xong).
import { JOB_DELTA_TEXT_MAX, type RunEvent } from "@ai/contracts/hub";
import { chunkDelta } from "../../stream/delta.rules";

export class DifyDeltaFeed {
  readonly #items: RunEvent[] = [];
  #wake: (() => void) | null = null;
  #seq = 1;

  constructor(private readonly jobId: string) {}

  /** `seq` cuối đã cấp (sự kiện kết thúc = `seq + 1`). */
  get seq(): number {
    return this.#seq;
  }

  /** `onDelta` của `DifyClient.runStreaming` (không ném). */
  readonly push = (text: string): void => {
    for (const part of chunkDelta(text, JOB_DELTA_TEXT_MAX)) {
      this.#seq += 1;
      const at = new Date().toISOString();
      const ev = { v: 1, job_id: this.jobId, seq: this.#seq, at, type: "job.delta" } as const;
      this.#items.push({ ...ev, kind: "done", text: part });
    }
    this.#ping();
  };

  #ping(): void {
    const w = this.#wake;
    this.#wake = null;
    w?.();
  }

  /** Phát `job.delta` khi tới cho tới khi `work` xong (rồi phát nốt phần còn lại); trả kết quả `work`. */
  async *follow<T>(work: Promise<T>): AsyncGenerator<RunEvent, T> {
    let done = false;
    const settled = work.finally(() => {
      done = true;
      this.#ping();
    });
    for (;;) {
      while (this.#items.length > 0) yield this.#items.shift() as RunEvent;
      if (done) break;
      await new Promise<void>((resolve) => {
        this.#wake = resolve;
      });
    }
    return await settled;
  }
}
