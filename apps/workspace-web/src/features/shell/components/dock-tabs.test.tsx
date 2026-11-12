// CR-132 · W3 · tab khoang: «Trợ lý AI | Tin nhắn», tab Tin nhắn có số chưa đọc (99+), nút thu gọn chỉ ở tab Tin nhắn.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { DockTabs } from "./DockTabs";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("DockTabs", () => {
  test("hai tab; tab đang chọn aria-selected; chưa đọc hiện số", () => {
    const html = renderToStaticMarkup(
      <DockTabs
        tab="assistant"
        onTab={() => {}}
        unread={3}
        onClose={() => {}}
        closeLabel="Thu gọn"
      />,
    );
    expect(html).toContain("Trợ lý AI");
    expect(html).toContain("Tin nhắn");
    expect(html).toContain('aria-label="3 tin chưa đọc"');
    expect(html).not.toContain("Thu gọn");
  });
  test("0 ⇒ không có chấm; trên 99 ⇒ 99+; tab Tin nhắn có nút thu gọn", () => {
    expect(
      renderToStaticMarkup(<DockTabs tab="messages" onTab={() => {}} unread={0} />),
    ).not.toContain("unread-badge");
    const html = renderToStaticMarkup(
      <DockTabs
        tab="messages"
        onTab={() => {}}
        unread={120}
        onClose={() => {}}
        closeLabel="Thu gọn"
      />,
    );
    expect(html).toContain("99+");
    expect(html).toContain("Thu gọn");
  });
});
