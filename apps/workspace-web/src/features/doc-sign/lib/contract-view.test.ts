// CR-181 · s13 · luật thuần ký trên tài liệu ở trang HĐ.
import { describe, expect, test } from "bun:test";
import type { SignFieldOut, SignFileOut, SignSessionOut } from "@ai/contracts/pack-contracts";
import {
  allSigned,
  checklist,
  fileStatus,
  hasSignFiles,
  hideLegacyEsign,
  myProgress,
  partnerWaitOf,
  showsPrepCard,
  signDoneByMe,
  signErrKey,
  signerChips,
  signStepOf,
  switchWhy,
  waitingNames,
  waitLabelOf,
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

describe("fix-cr181-uat · lỗi 1/2 · bước Ký trên tài liệu ở trang HĐ", () => {
  const grp = {
    side: "A",
    kind: "group",
    ref: "g1",
    name: "Đại diện Người ký HĐ",
    mine: false,
  } as const;
  const members = [
    { id: "u1", name: "Nguyễn Văn Hùng" },
    { id: "u2", name: "Trần Thị Mai" },
  ];
  test("signStepOf: có lượt ký ⇒ mine, không phải người ký ⇒ other, bước khác ⇒ null", () => {
    expect(signStepOf(sess([], { turn: { allowed: true, step: "sign", run_id: "r" } }))).toBe(
      "mine",
    );
    expect(signStepOf(sess([], { turn: { allowed: false, reason: "NOT_SIGNER" } }))).toBe("other");
    expect(signStepOf(sess([], { turn: { allowed: true, step: "approve", run_id: "r" } }))).toBe(
      null,
    );
    expect(signStepOf(sess([], { turn: { allowed: false, reason: "NO_SIGN_STEP" } }))).toBe(null);
  });
  test("nhóm có thành viên ⇒ chip và dòng «chờ» nói tên người", () => {
    const f = file({ fields: [fld({ signer_kind: "group", signer_ref: "g1" })] });
    const s = sess([f], { signers: [{ ...grp, members }] });
    expect(signerChips(s)[0]?.name).toBe("Nguyễn Văn Hùng, Trần Thị Mai");
    expect(waitingNames(s)).toBe("Nguyễn Văn Hùng, Trần Thị Mai");
  });
  test("nhóm không có thành viên ⇒ vẫn tên nhóm, người đã ký hết không còn trong «chờ»", () => {
    expect(signerChips(sess([], { signers: [grp] }))[0]?.name).toBe("Đại diện Người ký HĐ");
    const f = file({
      fields: [
        fld({ signer_ref: "u1", signed: true }),
        fld({ id: "g", signer_ref: "u2", signed: false }),
      ],
    });
    const s = sess([f], {
      signers: [
        { side: "A", kind: "user", ref: "u1", name: "An", mine: false },
        { side: "A", kind: "user", ref: "u2", name: "Bình", mine: false },
      ],
    });
    expect(waitingNames(s)).toBe("Bình");
  });
});

describe("fix-cr181-uat2 · lỗi 1 · Bên A ký đủ, chờ Bên B; không còn khối ký số cũ", () => {
  const A = { side: "A", kind: "user", ref: "u1", name: "An", mine: false } as const;
  const B = { side: "B", kind: "partner", ref: "b@x.vn", name: "Anh Bảo", mine: false } as const;
  const done = file({
    file_id: "p1",
    latest: { version_id: "v1", seq: 1, url: "" },
    fields: [
      fld({ signed: true }),
      fld({ id: "b", side: "B", signer_kind: "partner", signer_ref: "b@x.vn" }),
    ],
  });
  test("A ký đủ + còn chỗ Bên B ⇒ nói tên liên hệ và trỏ tới bản đã ký", () => {
    expect(partnerWaitOf(sess([done], { signers: [A, B] }))).toEqual({
      name: "Anh Bảo",
      fileId: "p1",
    });
  });
  test("A chưa ký đủ / không có Bên B / không tệp cần ký ⇒ null", () => {
    const open = file({ latest: { version_id: null, seq: 0, url: "" }, fields: [fld({})] });
    expect(partnerWaitOf(sess([open], { signers: [A, B] }))).toBeNull();
    expect(partnerWaitOf(sess([done], { signers: [A] }))).toBeNull();
    expect(partnerWaitOf(sess([], { signers: [A, B] }))).toBeNull();
  });
  test("khối ký số cũ ẩn khi công ty bật + có tệp cần ký (mọi trạng thái), tắt hoặc không tệp ⇒ hiện", () => {
    expect(hideLegacyEsign(sess([done]))).toBe(true);
    expect(hideLegacyEsign(sess([done], { enabled: false }))).toBe(false);
    expect(hideLegacyEsign(sess([file({ needs_sign: false })]))).toBe(false);
    expect(hideLegacyEsign(undefined)).toBe(false);
  });
});

describe("fix-cr181-uat2 · thông báo trùng ở HĐ Nháp", () => {
  test("thẻ Chuẩn bị chỗ ký (có danh sách kiểm tra) chỉ khi Nháp + chế độ chuẩn bị", () => {
    expect(showsPrepCard("draft", sess([], { mode: "prep" }))).toBe(true);
    expect(showsPrepCard("draft", sess([], { mode: "sign" }))).toBe(false);
    expect(showsPrepCard("processing", sess([], { mode: "prep" }))).toBe(false);
    expect(showsPrepCard("draft", undefined)).toBe(false);
  });
});

describe("fix-cr182-wait · chờ đối tác cho mọi người xem; người ký A đã ký xong", () => {
  const A = { side: "A", kind: "user", ref: "u1", name: "Giám đốc", mine: false } as const;
  const B = { side: "B", kind: "partner", ref: "b@x.vn", name: "Anh Bảo", mine: false } as const;
  const mkDone = (mine: boolean) =>
    file({
      file_id: "p1",
      latest: { version_id: "v1", seq: 1, url: "" },
      fields: [
        fld({ signed: true, mine }),
        fld({ id: "b", side: "B", signer_kind: "partner", signer_ref: "b@x.vn" }),
      ],
    });
  const link = { state: "open" } as never;
  test("sale (NOT_SIGNER) khi Bên A đã ký đủ ⇒ KHÔNG là 'other' (không «Chờ Giám đốc ký»)", () => {
    const s = sess([mkDone(false)], {
      signers: [A, B],
      turn: { allowed: false, reason: "NOT_SIGNER" },
      partner_link: link,
    });
    expect(signStepOf(s)).toBeNull();
    expect(partnerWaitOf(s)?.name).toBe("Anh Bảo");
  });
  test("A chưa ký đủ ⇒ vẫn 'other'", () => {
    const open = file({ fields: [fld({})] });
    expect(
      signStepOf(sess([open], { signers: [A, B], turn: { allowed: false, reason: "NOT_SIGNER" } })),
    ).toBe("other");
  });
  test("giám đốc đã ký hết ô mà lượt còn allowed ⇒ myProgress ready, có ô ⇒ dùng để báo «đã ký xong»", () => {
    const s = sess([mkDone(true)], {
      signers: [A, B],
      turn: { allowed: true, step: "sign", run_id: "r" },
    });
    expect(signStepOf(s)).toBe("mine");
    expect(myProgress(s)).toMatchObject({ fields: 1, signed: 1, ready: true });
    expect(signDoneByMe(s)).toBe(true);
  });
  test("còn ô chưa ký ⇒ chưa xong", () => {
    const f = file({ fields: [fld({ mine: true })] });
    expect(signDoneByMe(sess([f], { turn: { allowed: true, step: "sign", run_id: "r" } }))).toBe(
      false,
    );
  });
  test("nhãn chờ: có đối tác ⇒ «partner», còn người ký A ⇒ «signer»", () => {
    expect(waitLabelOf(sess([mkDone(false)], { signers: [A, B] }))).toEqual({
      kind: "partner",
      name: "Anh Bảo",
    });
    const open = file({ fields: [fld({})] });
    expect(waitLabelOf(sess([open], { signers: [A, B] }))).toEqual({
      kind: "signer",
      name: "Giám đốc",
    });
  });
});

describe("fix-cr182-signed-label · nhãn «Đã ký» khi mọi tệp cần ký đã ký đủ", () => {
  const A1 = fld({ signed: true });
  const B1 = (signed: boolean) =>
    fld({ id: "b", side: "B", signer_kind: "partner", signer_ref: "b@x.vn", signed });
  test("Bên A + Bên B đã ký ⇒ true", () => {
    expect(allSigned(sess([file({ fields: [A1, B1(true)] })]))).toBe(true);
  });
  test("còn chờ đối tác ⇒ false, Bên A chưa ký ⇒ false", () => {
    expect(allSigned(sess([file({ fields: [A1, B1(false)] })]))).toBe(false);
    expect(allSigned(sess([file({ fields: [fld({})] })]))).toBe(false);
  });
  test("không có tệp cần ký, hoặc công ty tắt ⇒ false (nhãn như cũ)", () => {
    expect(allSigned(sess([file({ needs_sign: false })]))).toBe(false);
    expect(allSigned(sess([file({ fields: [A1] })], { enabled: false }))).toBe(false);
  });
  test("một tệp chưa đủ ⇒ false", () => {
    expect(
      allSigned(sess([file({ fields: [A1] }), file({ file_id: "q", fields: [fld({})] })])),
    ).toBe(false);
  });
});
