// WRK-FR-03 · H2b-R19, R22, R23 · luật delta khi stream (plan-rules, plan §5.5). Thuần.
// B0: chỉ chữ ký (B9).

export type DeltaKind = "answer" | "done" | "partial";

export type StreamJob = {
  role: "orchestrator" | "agent";
  runKind: "orchestrated" | "direct" | "command";
  firstDelegate: boolean;
};

export type Reconciled = {
  rest: string;
  content: string;
  trace: null | "delta_mismatch" | "stream_unparsed";
};

/** R19: loại delta Hub nhận cho job; `[]` ⇒ `payload.stream = false`. */
export function streamAccept(_j: StreamJob): DeltaKind[] {
  throw new Error("not implemented: streamAccept");
}

/** `seq` delta liền mạch: `prev = null` ⇒ `seq === 1`; khác ⇒ `seq === prev + 1`. */
export function nextSeqOk(_prev: number | null, _seq: number): boolean {
  throw new Error("not implemented: nextSeqOk");
}

/** R22–R23: khớp phần đã phát `S` với kết quả cuối `F` (null = JSON cuối hỏng). */
export function reconcileStream(_s: string, _f: string | null): Reconciled {
  throw new Error("not implemented: reconcileStream");
}
