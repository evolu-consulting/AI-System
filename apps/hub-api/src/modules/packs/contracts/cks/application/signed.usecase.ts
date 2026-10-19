// HD-FR-95 · BR-9 · D9-12 · D9-16: tải văn bản đã ký — đọc từng tệp NGOÀI tx (CPU, tuần tự để không giữ mọi tệp đã giải mã),
// rồi MỘT tx: khoá + MỘT câu chèn lô JSON (khớp serial bằng join, trùng (sha256, serial) ⇒ bỏ qua). Port `routes/signed_docs.py`
// + `signed/store.py`: mỗi (tệp, serial) một hàng; serial lạ ⇒ `unmatched`; đuôi sai / quá 20 MB ⇒ `unreadable`.
import type { PackWho } from "../../../kit/application/ports";
import { parseSigned } from "../domain/signed.rules";
import type { CksUow, SignedDocWrite } from "./ports";

export type UploadFile = { name: string; size: number; bytes(): Promise<Uint8Array> };
export const FILE_MAX_BYTES = 20 * 1024 * 1024;

/** Hàng ghi của một tệp; null ⇒ `unreadable`. */
async function rowsOf(
  f: UploadFile,
  sha256: (b: Uint8Array) => string,
): Promise<SignedDocWrite[] | null> {
  const name = (f.name || "file").slice(0, 255);
  if (f.size > FILE_MAX_BYTES) return null;
  const raw = await f.bytes();
  const doc = parseSigned(raw, name);
  if (!doc) return null;
  const base = {
    sha256: sha256(raw),
    kind: doc.kind,
    number: doc.number,
    title: doc.title,
    signed_at: doc.signed_at,
    period: doc.period,
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
