// HUB-FR-10 · SendErrorNotice (render tĩnh): role alert, câu lỗi, "Ý bạn là" + nút gợi ý.
import { beforeAll, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { SendErrorNotice } from "./SendErrorNotice";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

test("alert + câu lỗi + gợi ý '/translate'", () => {
  const html = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <SendErrorNotice
        view={{
          lines: [{ key: "sendError.cmdNotFound", params: { name: "tranlate" } }],
          suggestions: ["translate"],
        }}
        onPick={() => {}}
      />
    </I18nextProvider>,
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain("Không có lệnh /tranlate.");
  expect(html).toContain("Ý bạn là:");
  expect(html).toContain(">/translate</button>");
});
