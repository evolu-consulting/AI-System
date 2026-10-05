// WRK-FR-03 · H2b-R19, R22, R23 · luật delta khi stream (plan-rules, plan §5.5). Thuần.
import { chunkText } from "../orchestrator/orchestrator.rules";

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

/** R19: loại delta Hub nhận cho job; `[]` ⇒ `payload.stream = false` (bảng plan §5.5). */
export function streamAccept(j: StreamJob): DeltaKind[] {
  if (j.runKind === "command") return [];
  if (j.role === "orchestrator") return ["answer"];
  if (j.runKind === "direct") return ["done", "partial"];
  return j.firstDelegate ? ["done"] : [];
}

/** `seq` delta liền mạch: `prev = null` ⇒ `seq === 1`; khác ⇒ `seq === prev + 1`. */
export function nextSeqOk(prev: number | null, seq: number): boolean {
  return prev === null ? seq === 1 : seq === prev + 1;
}

/** R22–R23: khớp phần đã phát `S` với kết quả cuối `F` (null = JSON cuối hỏng). Tiền tố theo đơn vị UTF-16. */
export function reconcileStream(s: string, f: string | null): Reconciled {
  if (s === "") return { rest: f ?? "", content: f ?? "", trace: null };
  if (f === null) return { rest: "", content: s, trace: "stream_unparsed" };
  if (f.startsWith(s)) return { rest: f.slice(s.length), content: f, trace: null };
  return { rest: "", content: s, trace: "delta_mismatch" };
}

/**
 * Cắt `delta` SSE: theo từ như `chunkText` (H1-R09) rồi bảo đảm mỗi phần ≤ `max` **đơn vị UTF-16** (emoji = 2), không
 * tách đôi cặp surrogate. Nối lại = `text`.
 */
export function chunkDelta(text: string, max = 40): string[] {
  const out: string[] = [];
  for (const part of chunkText(text, max)) {
    if (part.length <= max) {
      out.push(part);
      continue;
    }
    let cur = "";
    for (const cp of part) {
      if (cur.length + cp.length > max) {
        out.push(cur);
        cur = "";
      }
      cur += cp;
    }
    if (cur) out.push(cur);
  }
  return out;
}
