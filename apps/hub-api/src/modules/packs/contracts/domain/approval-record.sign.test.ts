// CR-181 · s10 · luật thuần: hình chữ ký + tệp + mã kiểm tra trong hồ sơ; BR-X2 (người chỉ xem thấy hình, không thấy ý kiến).
import { describe, expect, test } from "bun:test";
import {
  buildApprovalRecord,
  buildSignInfo,
  checkCode,
  type RecordRow,
  type SignVersionRow,
} from "./approval-record.rules";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const ST = "51515151-5151-4515-8515-515151515151";
const SHA = `abcdef12${"0".repeat(56)}`;
const v = (o: Partial<SignVersionRow>): SignVersionRow => ({
  fileId: F1,
  fileName: "hd.pdf",
  outName: "hd-ky.pdf",
  seq: 1,
  sha256: SHA,
  signedBy: A,
  kind: "internal",
  at: "2026-11-11T09:00:00.000000Z",
  stampId: ST,
  ...o,
});
const names = new Map([
  [A, "Hoa"],
  [B, "Lan"],
]);
const row = (actor: string): RecordRow => ({
  taskId: "t",
  stage: "Ký",
  action: "approve",
  at: "2026-11-11T09:00:00Z",
  actor,
  feedback: "ý kiến kín",
  evidence: null,
});

describe("approval-record.rules · hình chữ ký", () => {
  test("mã kiểm tra = 8 ký tự đầu của sha256, viết hoa", () =>
    expect(checkCode(SHA)).toBe("ABCDEF12"));
  test("mỗi người một dòng; tệp: bản gốc + bản đã ký cuối kèm sha256", () => {
    const { signs, files } = buildSignInfo(
      [
        v({}),
        v({
          seq: 2,
          signedBy: B,
          kind: "digital",
          outName: "hd-ky2.pdf",
          sha256: `1234abcd${"0".repeat(56)}`,
          stampId: null,
        }),
      ],
      names,
    );
    expect(signs.map((s) => [s.user.display_name, s.kind, s.files_signed, s.stamp_id])).toEqual([
      ["Hoa", "internal", 1, ST],
      ["Lan", "digital", 1, null],
    ]);
    expect(files.map((f) => [f.kind, f.name, f.check_code])).toEqual([
      ["original", "hd.pdf", null],
      ["signed", "hd-ky2.pdf", "1234ABCD"],
    ]);
  });
  test("người chỉ xem vẫn thấy hình chữ ký + tệp (BR-X2) nhưng không thấy ý kiến", () => {
    const out = buildApprovalRecord([row(A)], names, false, [v({})]);
    expect(out.items[0]?.feedback).toBe("ý kiến kín"); // feedback không gắn bằng chứng vẫn hiện; ý kiến của bằng chứng thì ẩn (BR-26)
    expect(out.items[0]?.sign?.stamp_id).toBe(ST);
    expect(out.signs?.length).toBe(1);
    expect(out.files?.length).toBe(2);
  });
  test("không có bản ký ⇒ không thêm khóa mới (tương thích ngược)", () => {
    const out = buildApprovalRecord([row(A)], names, true);
    expect("signs" in out || "files" in out || "sign" in (out.items[0] ?? {})).toBe(false);
  });
});

describe("fix-cr181-uat2 · mỗi bước một dòng — bước Ký trên tài liệu", () => {
  test("người ký không có quyết định duyệt có dòng riêng «Ký hợp đồng» (ai, lúc nào, loại, số tệp, hình)", () => {
    const out = buildApprovalRecord([row(A)], names, true, [
      v({ signedBy: A }),
      v({ signedBy: B, at: "2026-11-11T10:00:00.000000Z", kind: "digital" }),
    ]);
    expect(out.items.map((i) => i.action)).toEqual(["approve", "sign"]);
    const s = out.items[1];
    expect(s?.stage).toBe("Ký hợp đồng");
    expect(s?.actor.display_name).toBe("Lan");
    expect(s?.evidence).toBeNull();
    expect(s?.sign).toMatchObject({ kind: "digital", files_signed: 1, stamp_id: ST });
  });
  test("người đã có dòng duyệt không bị lặp dòng ký, không có bản ký ⇒ không thêm dòng", () => {
    expect(buildApprovalRecord([row(A)], names, true, [v({})]).items).toHaveLength(1);
    expect(buildApprovalRecord([row(A)], names, true, []).items).toHaveLength(1);
  });
});
