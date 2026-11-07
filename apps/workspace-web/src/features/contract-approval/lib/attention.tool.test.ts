// CR-122 · p19-tool-reason: mã lỗi bước tự động (`attention.code`) ⇒ khoá i18n "vì sao + làm gì"; mọi khoá có trong vi + en.
import { describe, expect, test } from "bun:test";
import en from "../../../../../../packages/i18n/locales/contracts/en.json";
import vi from "../../../../../../packages/i18n/locales/contracts/vi.json";
import { attentionText } from "./attention";

const B = "contracts.approval.engine.attention.reason";
const d = (code: string | null) =>
  attentionText({ kind: "needs_decision", reason: "tool_failed", code });
type Tree = { [k: string]: Tree | string };
const leaf = (t: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o as Tree | undefined)?.[k], t);

describe("attentionText · mã lỗi tool", () => {
  test("mã biết ⇒ khoá riêng", () => {
    for (const c of ["ESIGN_DISABLED", "ESIGN_UNSUPPORTED_FILE", "NO_PARTNER_EMAIL", "TOOL_OFF"])
      expect(d(c).key).toBe(`${B}.tool.${c}`);
  });
  test("MISSING_ARG:<tên> ⇒ nêu tên đầu vào", () => {
    expect(d("MISSING_ARG:contract_id")).toEqual({
      key: `${B}.tool.MISSING_ARG`,
      vars: { keys: "contract_id" },
    });
  });
  test("mã lạ ⇒ câu chung kèm mã, không mã ⇒ câu cũ", () => {
    expect(d("WEIRD_CODE")).toEqual({ key: `${B}.tool.UNKNOWN`, vars: { code: "WEIRD_CODE" } });
    expect(d(null).key).toBe(`${B}.tool_failed`);
  });
  test("retry_exhausted giữ câu cũ dù có mã", () => {
    expect(
      attentionText({ kind: "needs_decision", reason: "retry_exhausted", code: "UPSTREAM_ERROR" })
        .key,
    ).toBe(`${B}.retry_exhausted`);
  });
  test("khoá i18n đủ ở vi + en", () => {
    const keys = [
      "ESIGN_DISABLED",
      "ESIGN_UNSUPPORTED_FILE",
      "NO_PARTNER_EMAIL",
      "MISSING_ARG",
      "UNKNOWN",
    ];
    for (const k of keys)
      for (const loc of [vi, en])
        expect(typeof leaf(loc, `contracts.approval.engine.attention.reason.tool.${k}`)).toBe(
          "string",
        );
  });
});
