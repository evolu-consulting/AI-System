import { describe, expect, test } from "bun:test";
import { findTermViolations, loadGlossary } from "./check-i18n-terms";
import { repoRoot } from "./lib/git";
import { type LocaleEntry, readLocaleEntries } from "./lib/locale-files";

const e = (file: string, value: string, lang: "vi" | "en" = "vi"): LocaleEntry => ({
  file,
  lang,
  key: "k",
  value,
});
const terms = [
  { prefer: "quy trình", forbid: ["\\bflow\\b"], flags: "i", scope: { exclude: ["chat/"] } },
  { prefer: "Nháp", forbid: ["^Bản nháp$"] },
];

describe("check-i18n-terms (CR-125 c3)", () => {
  test("bắt biến thể cấm trong giá trị vi, tôn trọng scope", () => {
    const v = findTermViolations(
      [
        e("vi.json", "Chọn Flow"),
        e("chat/vi.json", "luồng flow"),
        e("vi.json", "Bản nháp"),
        e("vi.json", "Bản nháp mới"),
      ],
      terms,
    );
    expect(v.map((x) => `${x.file}:${x.match}`)).toEqual(["vi.json:Flow", "vi.json:Bản nháp"]);
  });
  test("bỏ qua en và token tham số", () => {
    expect(
      findTermViolations([e("vi.json", "x", "en"), e("vi.json", "{{path:flow}}")], terms),
    ).toEqual([]);
  });
  test("nội dung gd0 sạch", () => {
    const root = repoRoot();
    expect(findTermViolations(readLocaleEntries(root), loadGlossary(root))).toEqual([]);
  });
});
