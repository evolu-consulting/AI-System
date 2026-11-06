// CR-121 c12 · Q3 · LevelControl không tràn (cắt + tooltip) và ⓘ giải nghĩa mức bằng lời nghiệp vụ.
import { beforeAll, expect, test } from "bun:test";
import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import vi from "../../../../../../../packages/i18n/locales/vi.json";
import { LevelControl, LevelHelp } from "./LevelControl";

const i18n = createInstance();
beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: vi } },
    interpolation: { escapeValue: false },
  });
});
const all = { off: true, read: true, write: true, admin: true };
const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(<I18nextProvider i18n={i18n}>{node}</I18nextProvider>);

test("mỗi mức cắt chữ (truncate) và có tooltip đầy đủ (title), không tràn khi thu gọn", () => {
  const html = wrap(
    <LevelControl value="write" available={all} ariaLabel="Quyền" onChange={() => {}} />,
  );
  for (const l of ["Tắt", "Xem", "Sửa", "Quản trị"]) {
    expect(html).toContain(`title="${l}"`);
    expect(html).toContain(`>${l}</span>`);
  }
  expect(html.match(/truncate/g)?.length).toBeGreaterThanOrEqual(4);
  expect(html).toContain("min-w-0");
});

test("mức thiếu feature trong catalog bị khoá; chỉ xem ⇒ khoá cả thanh", () => {
  const some = wrap(
    <LevelControl
      value="read"
      available={{ ...all, write: false, admin: false }}
      ariaLabel="Q"
      onChange={() => {}}
    />,
  );
  expect(some.match(/\sdisabled=""/g)?.length).toBe(2);
  const ro = wrap(
    <LevelControl value="read" available={all} ariaLabel="Q" disabled onChange={() => {}} />,
  );
  expect(ro.match(/\sdisabled=""/g)?.length).toBe(4);
});

test("ⓘ giải nghĩa: Xem = chỉ đọc · Sửa = tạo và sửa · Quản trị = thêm cài đặt app và người dùng", () => {
  const html = wrap(<LevelHelp />);
  expect(html).toContain("Xem = chỉ đọc");
  expect(html).toContain("Sửa = tạo và sửa");
  expect(html).toContain("Quản trị = thêm cài đặt app và người dùng");
  expect(html).toContain('aria-label="');
});
