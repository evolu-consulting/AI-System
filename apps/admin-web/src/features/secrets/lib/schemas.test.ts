// ADM-FR-50 · M2-R01 · schema form secret: tên, giá trị 8–2048 (biên), ghi chú ≤ 200.
import { describe, expect, test } from "bun:test";
import { fieldFromIssues, noteToValue, secretSchemas } from "./schemas";

const msg = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? null : (r.error?.issues[0]?.message ?? null);

describe("ADM-FR-50 · secretSchemas", () => {
  test("tên: chuẩn hoá HOA rồi kiểm regex", () => {
    const s = secretSchemas.create;
    expect(s.safeParse({ name: " dify_key ", value: "12345678", note: "" }).success).toBe(true);
    expect(msg(s.safeParse({ name: "a", value: "12345678", note: "" }))).toBe(
      "secrets.error.nameFormat",
    );
    expect(msg(s.safeParse({ name: "A".repeat(65), value: "12345678", note: "" }))).toBe(
      "secrets.error.nameFormat",
    );
  });

  test("giá trị: rỗng → valueRequired; 7 và 2049 → valueLength; 8 và 2048 hợp lệ; không trim", () => {
    const s = secretSchemas.replace;
    expect(msg(s.safeParse({ value: "" }))).toBe("secrets.error.valueRequired");
    expect(msg(s.safeParse({ value: "1234567" }))).toBe("secrets.error.valueLength");
    expect(s.safeParse({ value: "12345678" }).success).toBe(true);
    expect(s.safeParse({ value: "x".repeat(2048) }).success).toBe(true);
    expect(msg(s.safeParse({ value: "x".repeat(2049) }))).toBe("secrets.error.valueLength");
    expect(s.safeParse({ value: "  ab  c " }).success).toBe(true);
  });

  test("ghi chú ≤ 200 sau trim", () => {
    const s = secretSchemas.note;
    expect(s.safeParse({ note: "n".repeat(200) }).success).toBe(true);
    expect(msg(s.safeParse({ note: "n".repeat(201) }))).toBe("secrets.error.noteMax");
    expect(noteToValue("  ")).toBeNull();
    expect(noteToValue(" a ")).toBe("a");
  });

  test("VALIDATION_ERROR → trường và câu tĩnh", () => {
    expect(fieldFromIssues({ issues: [{ path: ["value"] }] })).toEqual({
      field: "value",
      key: "secrets.error.valueLength",
    });
    expect(fieldFromIssues({ issues: [] })).toBeNull();
    expect(fieldFromIssues(undefined)).toBeNull();
  });
});
