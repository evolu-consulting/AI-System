// CR-050 · SidebarGroup (render tĩnh): region đặt tên theo tiêu đề, nút thu gọn aria-expanded, huy hiệu, nút phụ.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { SidebarGroup } from "./SidebarGroup";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const render = (unread = 0) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SidebarGroup
        id="test"
        title="Nhóm"
        unread={unread}
        badgeTestId="unread-groups"
        action={<button type="button">+</button>}
      >
        <p>nội dung</p>
      </SidebarGroup>
    </I18nextProvider>,
  );

describe("SidebarGroup", () => {
  test("mặc định mở: region theo tiêu đề, aria-expanded=true, thấy nội dung + nút phụ", () => {
    const html = render();
    const id = /<span id="([^"]+)" class="truncate">Nhóm<\/span>/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<section aria-labelledby="${id}"`);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("<p>nội dung</p>");
    expect(html).toContain(">+</button>");
    expect(html).not.toContain("unread-groups");
  });
  test("chưa đọc > 0 → huy hiệu có testid", () => {
    expect(render(4)).toContain('data-testid="unread-groups"');
  });
});
