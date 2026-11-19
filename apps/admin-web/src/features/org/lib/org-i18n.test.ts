// CR-189 · admin-web nội suy bằng MỘT ngoặc `{name}` (app/i18n.ts) — chuỗi `orgEdit.*` viết `{{name}}` sẽ hiện nguyên ký tự thô trên màn hình.
import { describe, expect, test } from "bun:test";
import en from "../../../../../../packages/i18n/locales/en.json";
import vi from "../../../../../../packages/i18n/locales/vi.json";

const leaves = (o: unknown, path = ""): [string, string][] =>
  typeof o === "string"
    ? [[path, o]]
    : Object.entries((o ?? {}) as Record<string, unknown>).flatMap(([k, v]) =>
        leaves(v, path ? `${path}.${k}` : k),
      );
const doubleBrace = (file: { orgEdit: unknown }) =>
  leaves(file.orgEdit).filter(([, v]) => v.includes("{{"));

describe("chuỗi orgEdit của admin-web", () => {
  test("vi: không có nội suy hai ngoặc {{x}}", () => {
    expect(doubleBrace(vi)).toEqual([]);
  });
  test("en: không có nội suy hai ngoặc {{x}}", () => {
    expect(doubleBrace(en)).toEqual([]);
  });
});
