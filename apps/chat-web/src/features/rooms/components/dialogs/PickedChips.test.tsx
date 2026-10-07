// HUB-FR-96 · CHAT-AC-41 · PickedChips (render tĩnh): chip chủ nhóm, nút "Bỏ …", đếm "n / 50 · gồm bạn", trạng thái đầy.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { PickedChips } from "./PickedChips";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const thu = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Thu Hà",
  username: "thu",
  active: true,
};
const render = (full: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <PickedChips selfName="Lan Trần" picked={[thu]} full={full} onRemove={() => {}} />
    </I18nextProvider>,
  );

describe("PickedChips", () => {
  test("chủ nhóm, người đã chọn có nút Bỏ, đếm gồm bạn", () => {
    const html = render(false);
    expect(html).toContain("Lan Trần (bạn) · chủ nhóm");
    expect(html).toContain('aria-label="Bỏ Thu Hà"');
    expect(html).toContain("2 / 50 · gồm bạn");
    expect(html).not.toContain("Nhóm đã đủ 50 người");
  });
  test("đầy ⇒ hiện câu đủ 50 người", () => {
    expect(render(true)).toContain("Nhóm đã đủ 50 người");
  });
});
