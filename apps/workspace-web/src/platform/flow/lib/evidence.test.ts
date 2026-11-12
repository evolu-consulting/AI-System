// CR-127 · U4 · luật thuần của ô bằng chứng (BR-20…26).
import { describe, expect, test } from "bun:test";
import { EMPTY_EVIDENCE, evidenceBody, evidenceIssue, evidenceRuleOf } from "./evidence";

const ID = "11111111-1111-4111-8111-111111111111";
const plus = { mode: "opinion_plus", signature: true, files: true } as const;
const only = { mode: "opinion", signature: true, files: true } as const;

describe("evidenceRuleOf", () => {
  test("hành động không có ô bằng chứng ⇒ null", () => {
    expect(evidenceRuleOf({ kind: "none" })).toBeNull();
    expect(evidenceRuleOf(undefined)).toBeNull();
  });
  test("chế độ suy từ `required`, ưu tiên `evidence_mode` của task", () => {
    const i = { kind: "evidence", signature: true, files: true, required: true } as const;
    expect(evidenceRuleOf(i)?.mode).toBe("opinion_plus");
    expect(evidenceRuleOf({ ...i, required: false })?.mode).toBe("opinion");
    expect(evidenceRuleOf(i, "opinion")?.mode).toBe("opinion");
  });
});

describe("evidenceIssue", () => {
  test("thiếu ý kiến", () => {
    expect(evidenceIssue({ ...EMPTY_EVIDENCE, note: "  " }, only)).toBe("note");
  });
  test("chỉ ý kiến: đủ khi có ý kiến", () => {
    expect(evidenceIssue({ ...EMPTY_EVIDENCE, note: "ok" }, only)).toBeNull();
  });
  test("ý kiến + chữ ký/tệp: thiếu cả hai ⇒ proof; có chữ ký hoặc tệp ⇒ đủ", () => {
    const d = { ...EMPTY_EVIDENCE, note: "ok" };
    expect(evidenceIssue(d, plus)).toBe("proof");
    expect(evidenceIssue({ ...d, signatureId: ID }, plus)).toBeNull();
    expect(evidenceIssue({ ...d, fileIds: [ID] }, plus)).toBeNull();
  });
  test("quá dài / quá nhiều tệp", () => {
    expect(evidenceIssue({ ...EMPTY_EVIDENCE, note: "x".repeat(4001) }, only)).toBe("noteLong");
    expect(evidenceIssue({ note: "ok", signatureId: null, fileIds: Array(6).fill(ID) }, only)).toBe(
      "tooManyFiles",
    );
  });
});

describe("evidenceBody", () => {
  test("bỏ trường rỗng, cắt khoảng trắng", () => {
    expect(evidenceBody({ ...EMPTY_EVIDENCE, note: " ý kiến " }, only)).toEqual({ note: "ý kiến" });
  });
  test("kèm chữ ký + tệp khi ô được bật", () => {
    expect(evidenceBody({ note: "a", signatureId: ID, fileIds: [ID] }, plus)).toEqual({
      note: "a",
      signature_attachment_id: ID,
      attachment_ids: [ID],
    });
  });
  test("ô tệp/chữ ký tắt ⇒ không gửi", () => {
    const r = { mode: "opinion", signature: false, files: false } as const;
    expect(evidenceBody({ note: "a", signatureId: ID, fileIds: [ID] }, r)).toEqual({ note: "a" });
  });
});

describe("evidence_mode của bước quyết ô bằng chứng (j11)", () => {
  test("opinion ⇒ Duyệt/Trả lại/Từ chối đều hỏi ý kiến, không chữ ký/tệp", () => {
    for (const k of ["approve", "return", "reject"])
      expect(evidenceRuleOf({ kind: "none" }, "opinion", k)).toEqual({
        mode: "opinion",
        signature: false,
        files: false,
      });
  });
  test("opinion_plus ⇒ thêm chữ ký + tệp", () => {
    expect(evidenceRuleOf({ kind: "none" }, "opinion_plus", "approve")).toEqual({
      mode: "opinion_plus",
      signature: true,
      files: true,
    });
  });
  test("không có mode ⇒ như cũ; hành động khác (redo) không hỏi", () => {
    expect(evidenceRuleOf({ kind: "none" }, undefined, "approve")).toBeNull();
    expect(evidenceRuleOf({ kind: "none" }, "opinion", "redo")).toBeNull();
  });
});
