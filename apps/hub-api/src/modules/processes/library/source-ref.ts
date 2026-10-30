// CR-105 · readiness Cao · `source_ref` của def tenant vật chất hoá = sha256 (16 hex đầu) của TOÀN BỘ def đã biên dịch (JSON).
// Cùng nội dung ⇒ cùng ref ⇒ `ensureDef` 0 ghi; khác (đổi gán / xuất bản / Group tenant đổi id) ⇒ ghi lại. Gói gọi qua cổng
// (`PackRunsPort.sourceRefOf`) vì lớp 1–2 của gói không dùng `node:*`.
import { createHash } from "node:crypto";

export const defSourceRef = (def: unknown): string =>
  createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 16);
