// CR-181 · s13 · luật thuần ký trên tài liệu ở trang HĐ.
import { describe, expect, test } from "bun:test";
import type { SignFieldOut, SignFileOut, SignSessionOut } from "@ai/contracts/pack-contracts";
import {
  checklist,
  fileStatus,
  hasSignFiles,
  myProgress,
  signErrKey,
  signerChips,
  switchWhy,
} from "./contract-view";

const fld = (o: Partial<SignFieldOut>): SignFieldOut =>
  ({
    id: "f",
    side: "A",
    signer_kind: "user",
    signer_ref: "u1",
    label: "",
    parts: {},
    mine: false,
    signed: false,
    signed_by: null,
    signed_version_id: null,
    ...o,
  }) as SignFieldOut;
const file = (o: Partial<SignFileOut>): SignFileOut =>
  ({
    file_id: "p",
    name: "a.pdf",
    is_main: false,
    is_pdf: true,
    uploader_id: "u1",
    can_prep: true,
    pages: 3,
    needs_sign: true,
    signed_by_me_in_turn: false,
    latest: { version_id: null, seq: 0, url: "" },
    fields: [],
    ...o,
  }) as SignFileOut;
const sess = (files: SignFileOut[], o: Partial<SignSessionOut> = {}): SignSessionOut =>
  ({
    enabled: true,
    mode: "prep",
    locked: false,
    files,
    signers: [],
    readiness: { ready: true, missing: [] },
    turn: { allowed: false },
    kinds: { internal: true, digital: { enabled: false, reason: "" } },
    ...o,
  }) as SignSessionOut;

describe("fileStatus — đúng 5 trạng thái", () => {
  test("Tham khảo", () => expect(fileStatus(file({ needs_sign: false })).kind).toBe("ref"));
  test("Chưa ký (chưa đặt chỗ / chưa ai ký)", () => {
    expect(fileStatus(file({})).kind).toBe("unsigned");
    expect(fileStatus(file({ fields: [fld({}), fld({ id: "g" })] })).kind).toBe("unsigned");
  });
  test("1/2", () => {
    const s = fileStatus(file({ fields: [fld({ signed: true }), fld({ id: "g" })] }));
    expect(s).toEqual({ kind: "partial", signed: 1, total: 2 });
  });
  test("Chờ đối tác", () => {
    const s = fileStatus(file({ fields: [fld({ signed: true }), fld({ id: "g", side: "B" })] }));
    expect(s.kind).toBe("waitPartner");
  });
  test("Đã ký đủ", () => {
    expect(fileStatus(file({ fields: [fld({ signed: true })] })).kind).toBe("done");
  });
});

describe("fileStatus — tệp đã có bản ký", () => {
  const signedLatest = { version_id: "v1", seq: 1, url: "" };
  test("có bản ký nhưng còn ô chưa ký ⇒ Đang ký (x/y)", () => {
    const s = fileStatus(
      file({ latest: signedLatest, fields: [fld({ signed: true }), fld({ id: "g" })] }),
    );
    expect(s).toEqual({ kind: "partial", signed: 1, total: 2 });
  });
  test("có bản ký mà chữ ký không thuộc ô nào (tự do), còn ô chưa ký ⇒ Đang ký (0/1), không phải Chưa ký", () => {
    expect(fileStatus(file({ latest: signedLatest, fields: [fld({})] }))).toEqual({
      kind: "partial",
      signed: 0,
      total: 1,
    });
  });
  test("chưa có bản nào ⇒ vẫn Chưa ký", () => {
    expect(fileStatus(file({ fields: [fld({})] })).kind).toBe("unsigned");
  });
});

describe("công tắc Cần ký", () => {
  test("khoá với người không tải lên", () =>
    expect(switchWhy(file({ can_prep: false }), false)).toBe("notUploader"));
  test("khoá khi HĐ đã khoá", () => expect(switchWhy(file({}), true)).toBe("locked"));
  test("Word chưa bật ⇒ chặn", () =>
    expect(switchWhy(file({ is_pdf: false, needs_sign: false }), false)).toBe("notPdf"));
  test("người tải lên, chưa khoá ⇒ bấm được", () => expect(switchWhy(file({}), false)).toBeNull());
});

describe("Đạt khoá tới khi ký đủ", () => {
  const mine = (signed: boolean) => file({ fields: [fld({ mine: true, signed })] });
  test("chưa ký đủ ⇒ chưa ready", () => {
    const p = myProgress(sess([mine(false), mine(true)]));
    expect(p).toMatchObject({ files: 2, signed: 1, fields: 2, ready: false });
  });
  test("ký đủ ⇒ ready", () => expect(myProgress(sess([mine(true)])).ready).toBe(true));
  test("không có chỗ của tôi ⇒ ready", () => expect(myProgress(sess([file({})])).ready).toBe(true));
  test("lượt Duyệt, người duyệt KHÔNG có ô riêng: y = mọi tệp cần ký, x = tệp chính mình đã Lưu", () => {
    const ap = { turn: { allowed: true, step: "approve" as const, run_id: "r" } };
    const a = sess(
      [
        file({}),
        file({ file_id: "q", signed_by_me_in_turn: true }),
        file({ file_id: "z", needs_sign: false }),
      ],
      ap,
    );
    expect(myProgress(a)).toMatchObject({ files: 2, signed: 1, fields: 0, ready: false });
    const b = sess([file({ signed_by_me_in_turn: true })], ap);
    expect(myProgress(b)).toMatchObject({ files: 1, signed: 1, ready: true });
  });
  test("hasSignFiles", () => {
    expect(hasSignFiles(sess([file({ needs_sign: false })]))).toBe(false);
    expect(hasSignFiles(sess([file({})]))).toBe(true);
  });
});

describe("dải người ký, danh sách kiểm tra, mã lỗi", () => {
  test("chip: Đã ký / n chỗ / Chưa có chỗ", () => {
    const s = sess(
      [file({ fields: [fld({ signed: true }), fld({ id: "g", signer_ref: "u2" })] })],
      {
        signers: [
          { side: "A", kind: "user", ref: "u1", name: "An", mine: false },
          { side: "A", kind: "user", ref: "u2", name: "Bình", mine: false },
          { side: "A", kind: "user", ref: "u3", name: "Chi", mine: false },
        ],
      },
    );
    expect(signerChips(s).map((c) => [c.state, c.count])).toEqual([
      ["signed", 1],
      ["open", 1],
      ["none", 0],
    ]);
  });
  test("checklist từ readiness", () => {
    const s = sess([], { readiness: { ready: false, missing: [{ code: "NO_SIGN_FILE" }] } });
    expect(checklist(s)[0]).toMatchObject({ key: "hasFile", ok: false });
    const s2 = sess([], {
      readiness: {
        ready: false,
        missing: [
          {
            code: "NO_FIELD",
            file_id: "p",
            file_name: "a.pdf",
            signer_kind: "user",
            signer_ref: "u1",
            signer_name: "An",
          },
        ],
      },
    });
    expect(checklist(s2).some((i) => i.key === "fieldsFor" && !i.ok && i.name === "An")).toBe(true);
  });
  test("mã lỗi ký ⇒ khoá i18n", () => {
    expect(signErrKey("SIGN_REQUIRED")).toBe("contracts.docsignc.err.SIGN_REQUIRED");
    expect(signErrKey("SIGN_NOT_READY")).toBe("contracts.docsignc.err.SIGN_NOT_READY");
    expect(signErrKey("OTHER")).toBeNull();
  });
});
