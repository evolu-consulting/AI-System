// CHAT-AC-20, CHAT-AC-21, CHAT-AC-22 · ConversationItem (render tĩnh): link theo tiêu đề, aria-current, nút "Thao tác khác".
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { ConversationItem } from "./ConversationItem";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const conv = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Hợp đồng NDA",
  created_at: "2026-10-01T00:00:00.000Z",
  updated_at: "2026-10-01T00:00:00.000Z",
  flow_count: 2,
};
const render = (active: boolean) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ConversationItem
        conversation={conv}
        active={active}
        onOpen={() => {}}
        onRename={async () => {}}
        onDelete={() => {}}
      />
    </I18nextProvider>,
  );

describe("ConversationItem", () => {
  test("link có tiêu đề + href; nút aria-label 'Thao tác khác'", () => {
    const html = render(false);
    expect(html).toContain(`href="/c/${conv.id}"`);
    expect(html).toContain(">Hợp đồng NDA</a>");
    expect(html).toContain('aria-label="Thao tác khác"');
    expect(html).not.toContain("aria-current");
  });
  test("đang mở → aria-current=page", () => {
    expect(render(true)).toContain('aria-current="page"');
  });
});
