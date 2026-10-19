// I1 · khoá idempotent của importer mgmt-app: mọi hàng đích có id uuid v5 TẤT ĐỊNH từ (nguồn, loại, id mgmt) ⇒ chạy lại
// cùng nguồn ⇒ cùng id ⇒ `ON CONFLICT DO NOTHING` (không nhân đôi, chạy tiếp được sau khi đứt giữa chừng). Thuần.
import { createHash } from "node:crypto";

/** Namespace riêng của I1 (uuid v4 cố định, sinh một lần). */
export const I1_NAMESPACE = "5d0c6f0e-8f39-4c39-9a51-4a1f3f7e2b10";

const hexOf = (uuid: string): Uint8Array =>
  Uint8Array.from(Buffer.from(uuid.replace(/-/g, ""), "hex"));

/** uuid v5 (RFC 9562 §5.5) của `name` trong `ns`. */
export function uuidV5(name: string, ns: string = I1_NAMESPACE): string {
  const h = createHash("sha1").update(hexOf(ns)).update(name, "utf8").digest();
  const b = Uint8Array.from(h.subarray(0, 16));
  b[6] = ((b[6] as number) & 0x0f) | 0x50;
  b[8] = ((b[8] as number) & 0x3f) | 0x80;
  const s = Buffer.from(b).toString("hex");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

/** Id đích của bản ghi mgmt `(kind, mgmtId)` trong nguồn `source` (vd `mgmt-prod`). */
export const targetId = (source: string, kind: string, mgmtId: string): string =>
  uuidV5(`${source}\u0000${kind}\u0000${mgmtId}`);
