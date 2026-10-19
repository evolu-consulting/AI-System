// HD-FR-95 · BR-9 · D9-12 · D9-16: tải văn bản đã ký — đọc từng tệp NGOÀI tx (CPU, tuần tự để không giữ mọi tệp đã giải mã),
// rồi MỘT tx: khoá + MỘT câu chèn lô JSON (khớp serial bằng join, trùng (sha256, serial) ⇒ bỏ qua). Port `routes/signed_docs.py`
// + `signed/store.py`: mỗi (tệp, serial) một hàng; serial lạ ⇒ `unmatched`; đuôi sai / quá 20 MB ⇒ `unreadable`.
import type { PackWho } from "../../../kit/application/ports";
import { parseSigned } from "../domain/signed.rules";
import type { CksUow, SignedDocWrite } from "./ports";

export type UploadFile = { name: string; size: number; bytes(): Promise<Uint8Array> };
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
const SERIAL_KEY_MAX = 100;

/** Chuỗi từ tệp không tin cậy ⇒ ô text Postgres nhận được: bỏ NUL + surrogate lẻ, cắt độ dài (không 500 vì một tệp lạ). */
const pgText = (s: string, max: number): string =>
  s
    .replaceAll("\u0000", "")
    .slice(0, max)
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .trim();

/** Hàng ghi của một tệp; null ⇒ `unreadable`. */
async function rowsOf(
  f: UploadFile,
  sha256: (b: Uint8Array) => string,
): Promise<SignedDocWrite[] | null> {
  const name = pgText(f.name || "", 255) || "file";
  if (f.size > FILE_MAX_BYTES) return null;
  const raw = await f.bytes();
  const doc = parseSigned(raw, name);
  // Review m1: serial chứng thư > 100 ký tự hex (CHECK `serial_key ≤ 100`; serial thật ≤ 20 byte theo RFC 5280) ⇒ tệp này
  // `unreadable`, không làm hỏng cả lô tải lên.
  if (!doc || doc.serials.some((s) => s.length > SERIAL_KEY_MAX)) return null;
  const base = {
    sha256: sha256(raw),
    kind: doc.kind,
    number: doc.number === null ? null : pgText(doc.number, 100) || null,
    title: pgText(doc.title, 300) || "Văn bản",
    signed_at: doc.signed_at,
    period: doc.period === null ? null : pgText(doc.period, 50) || null,
    source: name.toLowerCase().endsWith(".pdf") ? ("pdf" as const) : ("xml" as const),
    filename: name,
  };
  if (!doc.serials.length) return [{ ...base, serial_key: null, unsigned: true }];
  return doc.serials.map((s) => ({ ...base, serial_key: s, unsigned: false }));
}

export function cksSigned(d: { uow: CksUow; sha256: (b: Uint8Array) => string }) {
  return async (who: PackWho, files: readonly UploadFile[]) => {
    const rows: SignedDocWrite[] = [];
    let unreadable = 0;
    for (const f of files) {
      const got = await rowsOf(f, d.sha256);
      if (got) rows.push(...got);
      else unreadable++;
    }
    if (!rows.length) return { added: 0, skipped: 0, unmatched: 0, unreadable };
    const got = await d.uow.tenant(who, async (r) => {
      await r.cks.lock();
      return r.cks.insertSignedDocs(rows);
    });
    return {
      added: got.added,
      skipped: rows.length - got.added,
      unmatched: got.unmatched,
      unreadable,
    };
  };
}
export type CksUpload = ReturnType<typeof cksSigned>;
