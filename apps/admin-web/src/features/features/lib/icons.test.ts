// ADM-FR-30 · D8 · bộ icon feature: 16 icon, giá trị lạ → package; mọi icon có nhãn VI/EN.
import { describe, expect, test } from "bun:test";
import en from "../../../../../../packages/i18n/locales/en.json";
import vi from "../../../../../../packages/i18n/locales/vi.json";
import { FEATURE_ICON_NAMES, FEATURE_ICONS, iconFor } from "./icons";

describe("ADM-FR-30 · feature icons", () => {
  test("16 icon, tên khớp contract FEATURE_ICON_RE", () => {
    expect(FEATURE_ICON_NAMES).toHaveLength(16);
    for (const n of FEATURE_ICON_NAMES) expect(n).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  test("giá trị lạ → package", () => {
    expect(iconFor("khong-co")).toBe(FEATURE_ICONS.package);
    expect(iconFor("zap")).toBe(FEATURE_ICONS.zap);
  });

  test("mọi icon có nhãn ở cả hai ngôn ngữ", () => {
    for (const n of FEATURE_ICON_NAMES) {
      expect((vi.features.icon as Record<string, string>)[n]).toBeTruthy();
      expect((en.features.icon as Record<string, string>)[n]).toBeTruthy();
    }
  });
});
