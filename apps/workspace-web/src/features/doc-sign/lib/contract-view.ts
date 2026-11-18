// CR-181 · s13 · luật thuần ký trên tài liệu cho TRANG HỢP ĐỒNG (bảng Tài liệu kèm, dải người ký, thẻ duyệt, lý do chặn Gửi duyệt).
// Bên A = công ty, Bên B = đối tác (Q6): chỗ ký Bên B không chặn hoàn tất.
import {
  type SignFileOut,
  type SignReadinessMissing,
  type SignSessionOut,
  type SignSignerOut,
  signerWho,
} from "@ai/contracts/pack-contracts";

export type FileStatusKind = "ref" | "unsigned" | "partial" | "waitPartner" | "done";
export type FileStatus = { kind: FileStatusKind; signed: number; total: number };

/** Tình trạng 1 tệp: Tham khảo · Chưa ký (chưa có bản ký) · Đang ký (n/m) · Chờ đối tác · Đã ký đủ (n/m = chỗ ký của công ty). */
export function fileStatus(f: SignFileOut): FileStatus {
  if (!f.needs_sign) return { kind: "ref", signed: 0, total: 0 };
  const own = f.fields.filter((x) => x.side === "A");
  const signed = own.filter((x) => x.signed).length;
  const partnerOpen = f.fields.some((x) => x.side === "B" && !x.signed);
  // Đã có bản ký (seq > 0, chưa bị bỏ) mà chưa ô nào được tính (chữ ký tự do) vẫn không còn là «Chưa ký».
  const hasVersion = f.latest.seq > 0;
  if (!hasVersion && (own.length === 0 || signed === 0))
    return { kind: "unsigned", signed, total: own.length };
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
  /** CR-184 · mỗi thành viên một avatar: người ⇒ chính họ (id = ref); nhóm ⇒ các thành viên; đối tác ⇒ id null (chữ cái đầu). */
  people: { id: string | null; name: string }[];
  mine: boolean;
  count: number;
  state: "none" | "open" | "signed";
};
function signerPeople(g: SignSignerOut): SignerChip["people"] {
  if (g.members?.length) return g.members.map((m) => ({ id: m.id, name: m.name }));
  return [{ id: g.kind === "user" ? g.ref : null, name: g.name }];
}
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
      name: signerWho(g),
      side: g.side,
      people: signerPeople(g),
      mine: g.mine,
      count: mine.length,
      state,
    };
  });
}

/**
 * Tiến độ của NGƯỜI GỌI. Lượt Duyệt (`turn.step = "approve"`): người duyệt phải ký MỌI tệp cần ký (vị trí tự chọn, BR-D2) dù không có ô riêng ⇒
 * y = số tệp cần ký, x = tệp chính người này đã Lưu trong lượt (`signed_by_me_in_turn`). Ngoài lượt Duyệt: tệp có chỗ ký của tôi, đã ký hết x/y.
 * `ready` ⇒ mở được «Đạt».
 */
export function myProgress(s: SignSessionOut): {
  files: number;
  signed: number;
  fields: number;
  ready: boolean;
} {
  const need = signFiles(s);
  const fields = need.reduce((n, f) => n + f.fields.filter((x) => x.mine).length, 0);
  if (s.turn.allowed && s.turn.step === "approve") {
    const signed = need.filter((f) => f.signed_by_me_in_turn).length;
    return { files: need.length, signed, fields, ready: signed === need.length };
  }
  const mineFiles = need.filter((f) => f.fields.some((x) => x.mine));
  const signed = mineFiles.filter((f) =>
    f.fields.filter((x) => x.mine).every((x) => x.signed),
  ).length;
  return { files: mineFiles.length, signed, fields, ready: signed === mineFiles.length };
}

/**
 * Bước Ký ondoc đang mở của HĐ (fix-cr181-uat, lỗi 1): người có lượt ⇒ "mine"; người ký công ty khác ⇒ "other" (lý do NOT_SIGNER);
 * không có bước Ký ondoc ⇒ null. Trang HĐ dùng để thay khối «Ký số / Tải lên bản đã ký» cũ bằng thẻ «Ký hợp đồng».
 */
export function signStepOf(s: SignSessionOut): "mine" | "other" | null {
  if (s.turn.allowed) return s.turn.step === "sign" ? "mine" : null;
  // Bên A đã ký đủ (đang chờ đối tác) ⇒ không còn «Chờ <người ký A> ký»: thẻ chờ đối tác nói bước kế (fix-cr182-wait).
  return s.turn.reason === "NOT_SIGNER" && partnerWaitOf(s) === null ? "other" : null;
}

/** Người có lượt Ký đã ký hết ô của mình (lượt còn mở vì Q9/chờ máy chủ chốt bước) ⇒ thẻ nói «Bạn đã ký xong», không mời ký lại. */
export function signDoneByMe(s: SignSessionOut): boolean {
  const p = myProgress(s);
  return s.turn.allowed && s.turn.step === "sign" && p.fields > 0 && p.ready;
}

/** Dòng trạng thái bước «Ký hợp đồng»: chờ đối tác (Bên A xong) hoặc chờ người ký công ty còn lại. */
export function waitLabelOf(s: SignSessionOut): { kind: "partner" | "signer"; name: string } {
  const w = partnerWaitOf(s);
  return w ? { kind: "partner", name: w.name } : { kind: "signer", name: waitingNames(s) };
}

/** Tên người ký phía công ty còn phải ký (đích danh): người ký chưa ký hết chỗ của mình; không có chỗ ký ⇒ mọi người ký bên A. */
export function waitingNames(s: SignSessionOut): string {
  const need = signFiles(s);
  const a = s.signers.filter((x) => x.side === "A");
  const open = a.filter((g) =>
    need.some((f) =>
      f.fields.some(
        (x) => x.side === "A" && x.signer_kind === g.kind && x.signer_ref === g.ref && !x.signed,
      ),
    ),
  );
  return [...new Set((open.length ? open : a).map(signerWho))].join(", ");
}

/**
 * Bên A đã ký đủ (mọi tệp cần ký: chỗ ký bên công ty đã ký hết, có ≥ 1 bản đã ký) mà còn chỗ ký Bên B chưa ký ⇒ tên liên hệ đối tác; khác ⇒ null.
 * Dùng cho dòng trạng thái «Chờ <đối tác> (Bên B) ký» ở trang HĐ mọi trạng thái (fix-cr181-uat2).
 */
export function partnerWaitOf(s: SignSessionOut): { name: string; fileId: string } | null {
  const need = signFiles(s);
  const b = s.signers.find((x) => x.side === "B");
  if (!b || need.length === 0) return null;
  const st = need.map((f) => fileStatus(f).kind);
  if (!st.every((k) => k === "done" || k === "waitPartner") || !st.includes("waitPartner"))
    return null;
  const signed = need.find((f) => f.latest.seq > 0);
  return signed ? { name: b.name, fileId: signed.file_id } : null;
}

/** Khối «Ký số / Gửi ký» cũ KHÔNG hiện khi công ty bật ký trên tài liệu và HĐ có tệp cần ký (ở mọi trạng thái): chỉ còn một đường ký. */
export const hideLegacyEsign = (s: SignSessionOut | undefined | null): boolean =>
  !!s && s.enabled && signFiles(s).length > 0;

/** Thẻ «Chuẩn bị chỗ ký» (có danh sách kiểm tra) hiện khi HĐ còn Nháp và phiên ở chế độ chuẩn bị. */
export const showsPrepCard = (status: string, s: SignSessionOut | undefined | null): boolean =>
  !!s && status === "draft" && s.mode === "prep";

/** CR-182: công ty bật + có tệp cần ký + MỌI tệp cần ký «Đã ký đủ» (Bên A xong, không còn chỗ Bên B chưa ký) ⇒ HĐ «Đã ký». */
export const allSigned = (s: SignSessionOut): boolean => {
  const need = signFiles(s);
  return s.enabled && need.length > 0 && need.every((f) => fileStatus(f).kind === "done");
};

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
