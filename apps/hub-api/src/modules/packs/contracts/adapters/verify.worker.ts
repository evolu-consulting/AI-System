// HD-FR-22 · ADR-0024 §3 · review HD2 Trung 1: kiểm trích dẫn văn bản lớn ngoài vòng sự kiện hub-api (khuôn `docx.worker.ts`).
// Nhận `{id, raw, source, kind}`, trả `{id, result}` hoặc `{id, error}`.
import { type RawExtraction, verifyExtraction } from "../domain/extraction.rules";

declare const self: Worker;

type In = { id: number; raw: RawExtraction; source: string | null; kind: "contract" | "appendix" };

self.onmessage = (ev: MessageEvent<In>) => {
  const { id, ...input } = ev.data;
  try {
    self.postMessage({ id, result: verifyExtraction(input) });
  } catch {
    self.postMessage({ id, error: true });
  }
};
