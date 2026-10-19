// N5-FR-01 · security M2 · biên file: NUL / surrogate lẻ ⇒ BAD_ROW; thiếu `source` ⇒ BAD_FILE; lỗi lớp 22/23 ⇒ hỏng một lô.
import { describe, expect, test } from "bun:test";
import { ImportAbort } from "../domain/errors";
import { constraintError } from "../identity-import.run";
import { parseExport } from "./import.mapper";

const base = { format: "mgmt-app-users/v1", source: "mgmt-test" };
const user = (o: Record<string, unknown> = {}) => ({
  email: "a@x.vn",
  name: "A",
  org_id: "o1",
  org_role: "editor",
  password_hash: null,
  ...o,
});

describe("N5-FR-01 · parseExport", () => {
  test("N5-FR-01 · thiếu/sai source ⇒ BAD_FILE", () => {
    expect(() => parseExport({ format: base.format, orgs: [], users: [] })).toThrow(ImportAbort);
    expect(() => parseExport({ ...base, source: "Có Dấu", orgs: [], users: [] })).toThrow(
      ImportAbort,
    );
  });
  test("N5-FR-01 · security M2: NUL hoặc surrogate lẻ ở mọi trường chuỗi ⇒ BAD_ROW; cặp surrogate hợp lệ thì qua", () => {
    const nul = String.fromCharCode(0);
    const r = parseExport({
      ...base,
      orgs: [{ id: `o${nul}`, name: "A" }],
      users: [
        user({ email: `a${nul}@x.vn` }),
        user({ name: "x\uDE00" }),
        user({ password_hash: "\uD83Dx" }),
        user({ org_id: `o1${nul}` }),
        user({ name: "ok 😀" }),
      ],
    });
    expect(r.issues.map((i) => i.ref)).toEqual([
      "orgs[0]",
      "users[0]",
      "users[1]",
      "users[2]",
      "users[3]",
    ]);
    expect(r.users.map((u) => u.name)).toEqual(["ok 😀"]);
    expect(r.source).toBe("mgmt-test");
  });
});

describe("N5-FR-05 · security M2 · constraintError", () => {
  test("N5-FR-05 · lớp 22 và 23 ⇒ hỏng một lô; lớp khác / không mã ⇒ ném tiếp", () => {
    expect(constraintError({ code: "22023" })).toBe("22023");
    expect(constraintError({ code: "23505" })).toBe("23505");
    expect(constraintError({ code: "40P01" })).toBeNull();
    expect(constraintError(new Error("x"))).toBeNull();
  });
});
