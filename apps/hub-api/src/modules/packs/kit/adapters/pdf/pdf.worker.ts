// ADR-0028: Bun Worker đọc lớp chữ PDF ngoài vòng sự kiện hub-api. Nhận `{id, bytes}`, trả `{id, result}`.
import { convertPdf } from "./convert";

declare const self: Worker;

self.onmessage = (ev: MessageEvent<{ id: number; bytes: Uint8Array }>) => {
  const { id, bytes } = ev.data;
  void convertPdf(bytes).then((result) => self.postMessage({ id, result }));
};
