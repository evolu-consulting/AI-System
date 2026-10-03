// CHAT-AC-18 · 4 thẻ gợi ý: nút theo tiêu đề, câu mẫu hiện trong thẻ.
import { beforeAll, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { SuggestionCards } from "./SuggestionCards";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

test("4 thẻ: Soạn email, Tóm tắt văn bản, Dịch, Lên dàn ý", () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SuggestionCards onPick={() => {}} />
    </I18nextProvider>,
  );
  expect((html.match(/<button/g) ?? []).length).toBe(4);
  for (const s of ["Soạn email", "Tóm tắt văn bản", "Dịch", "Lên dàn ý", "Soạn email báo giá"])
    expect(html).toContain(s);
});
