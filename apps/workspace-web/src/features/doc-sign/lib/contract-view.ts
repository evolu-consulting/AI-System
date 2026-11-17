// CR-181 · s13 · luật thuần ký trên tài liệu cho TRANG HỢP ĐỒNG (bảng Tài liệu kèm, dải người ký, thẻ duyệt, lý do chặn Gửi duyệt).
// Bên A = công ty, Bên B = đối tác (Q6): chỗ ký Bên B không chặn hoàn tất.
import type {
  SignFileOut,
  SignReadinessMissing,
  SignSessionOut,
  SignSignerOut,
} from "@ai/contracts/pack-contracts";

export type FileStatusKind = "ref" | "unsigned" | "partial" | "waitPartner" | "done";
export type FileStatus = { kind: FileStatusKind; signed: number; total: number };

/** Tình trạng 1 tệp: Tham khảo · Chưa ký · n/m · Chờ đối tác · Đã ký đủ (n/m = chỗ ký của công ty). */
export function fileStatus(f: SignFileOut): FileStatus {
  if (!f.needs_sign) return { kind: "ref", signed: 0, total: 0 };
  const own = f.fields.filter((x) => x.side === "A");
  const signed = own.filter((x) => x.signed).length;
  const partnerOpen = f.fields.some((x) => x.side === "B" && !x.signed);
  if (own.length === 0 || signed === 0) return { kind: "unsigned", signed, total: own.length };
  if (signed < own.length) return { kind: "partial", signed, total: own.length };
  return { kind: partnerOpen ? "waitPartner" : "done", signed, total: own.length };
}

/** Số chỗ ký mỗi bên của tệp: `{ a, b }`. */
export const fieldCounts = (f: SignFileOut) => ({
  a: f.fields.filter((x) => x.side === "A").length,
  b: f.fields.filter((x) => x.side === "B").length,
});

const signFiles = (s: SignSessionOut) => s.files.filter((f) => f.needs_sign);

/** Chip người ký: số chỗ ký trên mọi tệp cần ký · đã ký hết chưa. */
export type SignerChip = {
  key: string;
  name: string;
  side: "A" | "B";
  mine: boolean;
  count: number;
  state: "none" | "open" | "signed";
};
export function signerChips(s: SignSessionOut): SignerChip[] {
  const files = signFiles(s);
  return s.signers.map((g: SignSignerOut) => {
    const mine = files.flatMap((f) =>
      f.fields.filter(
        (x) => x.side === g.side && x.signer_kind === g.kind && x.signer_ref === g.ref,
      ),
    );
    const state = mine.length === 0 ? "none" : mine.every((x) => x.signed) ? "signed" : "open";
    return {
      key: `${g.side}:${g.kind}:${g.ref}`,
      name: g.name,
      side: g.side,
      mine: g.mine,
      count: mine.length,
      state,
    };
  });
}

/** Tiến độ của NGƯỜI GỌI: tệp có chỗ ký của tôi, đã ký hết x/y. `ready` ⇒ mở được «Đạt». */
export function myProgress(s: SignSessionOut): {
  files: number;
  signed: number;
  fields: number;
  ready: boolean;
} {
  const mineFiles = signFiles(s).filter((f) => f.fields.some((x) => x.mine));
  const signed = mineFiles.filter((f) =>
    f.fields.filter((x) => x.mine).every((x) => x.signed),
  ).length;
  const fields = mineFiles.reduce((n, f) => n + f.fields.filter((x) => x.mine).length, 0);
  return { files: mineFiles.length, signed, fields, ready: signed === mineFiles.length };
}

/** Có tệp cần ký (hiện khung «Ký trên tài liệu» ở thẻ duyệt). */
export const hasSignFiles = (s: SignSessionOut) => signFiles(s).length > 0;

export type ChecklistItem = {
  ok: boolean;
  key: "hasFile" | "fieldsFor";
  name?: string;
  file?: string;
};
/** Danh sách kiểm tra của người tải lên (từ `readiness`): có tệp cần ký · mỗi tệp có chỗ ký cho từng người. */
export function checklist(s: SignSessionOut): ChecklistItem[] {
  const miss = s.readiness.missing;
  const out: ChecklistItem[] = [
    { ok: !miss.some((m) => m.code === "NO_SIGN_FILE"), key: "hasFile" },
  ];
  const noField = miss.filter(
    (m): m is Extract<SignReadinessMissing, { code: "NO_FIELD" }> => m.code === "NO_FIELD",
  );
  const seen = new Set<string>();
  for (const m of noField) {
    const k = `${m.file_id}:${m.signer_ref}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ ok: false, key: "fieldsFor", name: m.signer_name, file: m.file_name });
    }
  }
  if (noField.length === 0 && out[0]?.ok) out.push({ ok: true, key: "fieldsFor" });
  return out;
}

/** Công tắc «Cần ký» của tệp: khoá vì sao (null = bấm được). */
export function switchWhy(
  f: SignFileOut,
  locked: boolean,
): "locked" | "notUploader" | "notPdf" | null {
  if (!f.is_pdf && !f.needs_sign) return "notPdf";
  if (locked) return "locked";
  return f.can_prep ? null : "notUploader";
}

/** Mã lỗi/ lý do chặn ⇒ khoá i18n (câu nghiệp vụ). Mã lạ ⇒ null. */
const SIGN_ERR = new Set([
  "SIGN_NOT_READY",
  "SIGN_REQUIRED",
  "DIGITAL_SIGN_NOT_ENABLED",
  "SIGNATURE_MISSING",
  "SIGN_VERSION_STALE",
  "SIGN_NOT_PDF",
  "SIGN_PDF_INVALID",
  "SIGN_TOO_MANY_PAGES",
  "SIGN_PDF_ENCRYPTED",
]);
export const signErrKey = (code: string | undefined): string | null =>
  code && SIGN_ERR.has(code) ? `contracts.docsignc.err.${code}` : null;
