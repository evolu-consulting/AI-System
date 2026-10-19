// PK-FR-07 · ADR-0024 §3: Bun Worker chuyển DOCX → Markdown ngoài vòng sự kiện hub-api. Nhận `{id, bytes}`, trả `{id, result}`.
import { convertDocx } from "./convert";

declare const self: Worker;

self.onmessage = (ev: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const { id, bytes } = ev.data;
  self.postMessage({ id, result: convertDocx(bytes) });
};
