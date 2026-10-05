// WRK-FR-03 · H2b-R22 · P11 · `DeltaSink` (plan §5.5): một per job được stream. Nhận mọi sự kiện không kết thúc của job
// (đã lọc `job_id` ở runner, A114), kiểm `seq` liền mạch (hở → ngừng chuyển tiếp + ghi `gap`), chuyển `job.delta` có
// `kind ∈ accept` thành SSE `delta` ≤ 40 đơn vị UTF-16, cộng dồn S (`text`) theo phần đã phát thành công.
import type { RunEvent } from "@ai/contracts/hub";
import { isJobTerminal } from "../runner/runner.rules";
import { chunkDelta, type DeltaKind, nextSeqOk, type StreamJob, streamAccept } from "./delta.rules";

export type DeltaGap = { expected: number; seen: number };

export class DeltaSink {
  #prev: number | null = null;
  #open = true;
  #text = "";
  #gap: DeltaGap | null = null;

  constructor(
    readonly accept: readonly DeltaKind[],
    private readonly emit: (text: string) => Promise<unknown>,
  ) {}

  /** S: phần đã phát. */
  get text(): string {
    return this.#text;
  }

  get gap(): DeltaGap | null {
    return this.#gap;
  }

  async onEvent(ev: RunEvent): Promise<void> {
    if (!this.#open || isJobTerminal(ev)) return;
    if (!nextSeqOk(this.#prev, ev.seq)) {
      this.#open = false;
      this.#gap = { expected: (this.#prev ?? 0) + 1, seen: ev.seq };
      return;
    }
    this.#prev = ev.seq;
    if (ev.type !== "job.delta" || !this.accept.includes(ev.kind)) return;
    for (const part of chunkDelta(ev.text)) {
      await this.emit(part);
      this.#text += part;
    }
  }
}

/** Sink cho job theo bảng §5.5; `accept = []` ⇒ không stream (undefined). */
export function deltaSinkFor(
  j: StreamJob,
  emit: (text: string) => Promise<unknown>,
): DeltaSink | undefined {
  const accept = streamAccept(j);
  return accept.length > 0 ? new DeltaSink(accept, emit) : undefined;
}
