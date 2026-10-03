// CHAT-AC-05, CHAT-AC-10 · Composer + QuotaNotice (render tĩnh): nhãn e2e, Gửi↔Dừng, khoá khi busy.
import { beforeAll, describe, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { Composer, type ComposerProps } from "./Composer";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const render = (p: Partial<ComposerProps> = {}) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <Composer variant="main" draftKey="chat:draft:new:main" onSubmit={async () => true} {...p} />
    </I18nextProvider>,
  );

describe("Composer", () => {
  test("ô chính: textbox 'Tin nhắn', placeholder, nút 'Gửi' disabled khi rỗng", () => {
    const html = render();
    expect(html).toContain('aria-label="Tin nhắn"');
    expect(html).toContain('placeholder="Hỏi điều mới…"');
    expect(html).toMatch(/<button[^>]*aria-label="Gửi"[^>]*disabled/);
  });
  test("đang chạy: nút 'Dừng' thay 'Gửi'", () => {
    const html = render({ running: true });
    expect(html).toContain('aria-label="Dừng"');
    expect(html).not.toContain('aria-label="Gửi"');
  });
  test("khung flow: nhãn riêng", () => {
    const html = render({ variant: "flow", locked: true });
    expect(html).toContain('aria-label="Tin nhắn trong flow"');
    expect(html).toContain('aria-label="Gửi trong flow"');
    expect(html).toContain("Đang có câu trả lời chạy");
  });
  test("QuotaNotice chỉ hiện khi over, có nút 'Ẩn nhắc'", () => {
    expect(render()).not.toContain("hạn mức");
    const html = render({ quotaOver: true });
    expect(html).toContain("hạn mức");
    expect(html).toContain('aria-label="Ẩn nhắc"');
  });
});
