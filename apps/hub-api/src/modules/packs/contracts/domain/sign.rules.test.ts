import { describe, expect, it } from "bun:test";
import {
  canPrepSign,
  captionText,
  defaultNeedsSign,
  fieldsIssue,
  isPdfFile,
  marksIssue,
  maskPartnerRef,
  needsSignIssue,
  normalizeFields,
  type SignerEntry,
  sessionMode,
  signReadiness,
  uploaderOf,
} from "./sign.rules";

const part = (page: number) => ({ page, x: 1, y: 1, w: 10, h: 4, cx: 1, cy: 1, cw: 10, ch: 4 });
const A: SignerEntry = { side: "A", kind: "user", ref: "u1", name: "An", mine: false };
const G: SignerEntry = {
  side: "A",
  kind: "group",
  ref: "g1",
  name: "Đại diện Ban GĐ",
  mine: false,
};
const B: SignerEntry = { side: "B", kind: "partner", ref: "b@x.vn", name: "Bình", mine: false };

describe("BR-T1/C2 ai chuẩn bị", () => {
  it("tệp chính = người tạo HĐ; tệp kèm = added_by", () => {
    expect(uploaderOf({ is_main: true, added_by: null }, "creator")).toBe("creator");
    expect(uploaderOf({ is_main: false, added_by: "x" }, "creator")).toBe("x");
  });
  it("chỉ người tải lên và chỉ khi chưa khoá", () => {
    expect(canPrepSign("u", "u", { status: "draft" })).toBe(true);
    expect(canPrepSign("other", "u", { status: "draft" })).toBe(false);
    expect(canPrepSign("u", "u", { status: "processing" })).toBe(false);
  });
});

describe("Q13/Q14/BR-T3 tệp cần ký", () => {
  it("nhận diện PDF theo MIME hoặc đuôi", () => {
    expect(isPdfFile({ name: "a.docx", mime: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "A.PDF", mime: "application/octet-stream" })).toBe(true);
    expect(isPdfFile({ name: "a.docx", mime: "application/msword" })).toBe(false);
  });
  it("mặc định: chính bật khi công ty bật và là PDF; kèm tắt", () => {
    expect(defaultNeedsSign({ is_main: true, is_pdf: true }, true)).toBe(true);
    expect(defaultNeedsSign({ is_main: true, is_pdf: true }, false)).toBe(false);
    expect(defaultNeedsSign({ is_main: true, is_pdf: false }, true)).toBe(false);
    expect(defaultNeedsSign({ is_main: false, is_pdf: true }, true)).toBe(false);
  });
  it("Word / mật khẩu / hỏng / > 50 trang bị chặn; 50 trang qua", () => {
    expect(needsSignIssue(false, null)).toBe("SIGN_NOT_PDF");
    expect(needsSignIssue(true, { ok: false, reason: "encrypted" })).toBe("SIGN_PDF_ENCRYPTED");
    expect(needsSignIssue(true, { ok: false, reason: "invalid" })).toBe("SIGN_PDF_INVALID");
    expect(needsSignIssue(true, { ok: true, pages: 51 })).toBe("SIGN_TOO_MANY_PAGES");
    expect(needsSignIssue(true, { ok: true, pages: 50 })).toBeNull();
  });
});

describe("BR-C1 kiểm chỗ ký", () => {
  const f = (kind: "user" | "group" | "partner", ref: string, side: "A" | "B" = "A", pg = 0) => ({
    side,
    signer_kind: kind,
    signer_ref: ref,
    parts: [part(pg)],
  });
  it("người ký thuộc danh sách (đúng bên) ⇒ ok; lạ ⇒ SIGN_SIGNER_UNKNOWN", () => {
    const ok = [f("user", "u1"), f("group", "g1"), f("partner", "B@x.vn", "B")];
    expect(fieldsIssue(ok, [A, G, B], 3)).toBeNull();
    expect(fieldsIssue([f("user", "u9")], [A], 3)).toBe("SIGN_SIGNER_UNKNOWN");
    expect(fieldsIssue([f("user", "u1", "B")], [A], 3)).toBe("SIGN_SIGNER_UNKNOWN");
  });
  it("trang ngoài tệp ⇒ SIGN_PAGE_NOT_FOUND; quá trần ⇒ SIGN_FIELDS_TOO_MANY", () => {
    expect(fieldsIssue([f("user", "u1", "A", 3)], [A], 3)).toBe("SIGN_PAGE_NOT_FOUND");
    expect(fieldsIssue([f("user", "u1", "A", 3)], [A], null)).toBeNull();
    const many = Array.from({ length: 41 }, () => f("user", "u1"));
    expect(fieldsIssue(many, [A], 3)).toBe("SIGN_FIELDS_TOO_MANY");
  });
});

describe("normalizeFields", () => {
  it("id lạ ⇒ id mới; id chỗ chưa ký giữ; id chỗ đã ký bị bỏ; id trùng ⇒ sinh mới", () => {
    let n = 0;
    const base = {
      side: "A" as const,
      signer_kind: "user" as const,
      signer_ref: "u1",
      parts: [part(0)],
    };
    const out = normalizeFields(
      [
        { ...base, id: "open" },
        { ...base, id: "open" },
        { ...base, id: "signed" },
        { ...base, id: "alien" },
        { ...base },
      ],
      [
        { id: "open", signed: false },
        { id: "signed", signed: true },
      ],
      () => `new${++n}`,
    );
    expect(out.map((x) => x.id)).toEqual(["open", "new1", "new2", "new3"]);
  });
});

describe("BR-C3 signReadiness", () => {
  const files = [
    { file_id: "f1", name: "hd.pdf", needs_sign: true },
    { file_id: "f2", name: "pl.pdf", needs_sign: false },
  ];
  it("không có tệp cần ký ⇒ NO_SIGN_FILE", () => {
    const r = signReadiness([{ file_id: "f2", name: "pl.pdf", needs_sign: false }], [], [A]);
    expect(r).toEqual({ ready: false, missing: [{ code: "NO_SIGN_FILE" }] });
  });
  it("thiếu chỗ ký cho từng người ký Bên A; Bên B không bắt buộc", () => {
    const r = signReadiness(
      files,
      [{ file_id: "f1", signer_kind: "user", signer_ref: "u1" }],
      [A, G, B],
    );
    expect(r.ready).toBe(false);
    expect(r.missing).toEqual([
      {
        code: "NO_FIELD",
        file_id: "f1",
        file_name: "hd.pdf",
        signer_kind: "group",
        signer_ref: "g1",
        signer_name: "Đại diện Ban GĐ",
      },
    ]);
    const full = [
      { file_id: "f1", signer_kind: "user", signer_ref: "u1" },
      { file_id: "f1", signer_kind: "group", signer_ref: "g1" },
    ];
    expect(signReadiness(files, full, [A, G, B])).toEqual({ ready: true, missing: [] });
  });
});

describe("chế độ", () => {
  it("prep > sign > view", () => {
    expect(sessionMode(true, true)).toBe("prep");
    expect(sessionMode(false, true)).toBe("sign");
    expect(sessionMode(false, false)).toBe("view");
  });
});

describe("marksIssue (BR-C1)", () => {
  const fields = [
    { id: "f1", signer_kind: "user", signer_ref: "u1", signed_version_id: null },
    { id: "f2", signer_kind: "user", signer_ref: "u2", signed_version_id: null },
    { id: "f3", signer_kind: "user", signer_ref: "u1", signed_version_id: "v" },
  ];
  const me: SignerEntry[] = [
    { ...A, mine: true },
    { ...A, ref: "u2", mine: false },
  ];
  it("dấu vào ô của mình ⇒ ok; ô của người khác / đã ký / không có ⇒ forbidden", () => {
    expect(marksIssue([{ placement: "field", field_id: "f1" }], fields, me)).toBeNull();
    expect(marksIssue([{ placement: "field", field_id: "f2" }], fields, me)).toBe("forbidden");
    expect(marksIssue([{ placement: "field", field_id: "f3" }], fields, me)).toBe("forbidden");
    expect(marksIssue([{ placement: "field", field_id: "zz" }], fields, me)).toBe("forbidden");
  });
  it("lệch kiểu dấu / trùng ô ⇒ invalid; dấu tự do không cần ô", () => {
    expect(marksIssue([{ placement: "free", field_id: "f1" }], fields, me)).toBe("invalid");
    expect(marksIssue([{ placement: "field" }], fields, me)).toBe("invalid");
    const dup = { placement: "field" as const, field_id: "f1" };
    expect(marksIssue([dup, dup], fields, me)).toBe("invalid");
    expect(marksIssue([{ placement: "seam" }, { placement: "initials" }], fields, me)).toBeNull();
  });
});

describe("captionText", () => {
  const now = new Date("2026-11-17T17:05:00Z"); // 00:05 ngày 18 giờ VN
  it("theo thiết lập, giờ Việt Nam; bỏ phần trống", () => {
    expect(captionText(["name", "date"], { name: "Bình", title: null }, now)).toBe(
      "Bình · 18/11/2026",
    );
    expect(captionText(["time", "title", "name"], { name: "Bình", title: "GĐ" }, now)).toBe(
      "Bình · GĐ · 00:05",
    );
    expect(captionText(["title"], { name: "Bình", title: null }, now)).toBeUndefined();
    expect(captionText([], { name: "Bình", title: "GĐ" }, now)).toBeUndefined();
  });
});

describe("X2 che email đối tác", () => {
  it("chỉ người chuẩn bị thấy ref đối tác", () => {
    const p = {
      side: "B" as const,
      kind: "partner" as const,
      ref: "b@x.vn",
      name: "B",
      mine: false,
    };
    expect(maskPartnerRef(p, true).ref).toBe("b@x.vn");
    expect(maskPartnerRef(p, false).ref).toBe("partner");
    expect(maskPartnerRef(A, false).ref).toBe("u1");
  });
});
