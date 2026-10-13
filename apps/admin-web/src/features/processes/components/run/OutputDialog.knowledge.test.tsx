// HUB-FR-134 · K1 F3: OutputBody render KnowledgeNotice dưới <pre>; knowledge vắng ⇒ chỉ <pre>.
import { beforeAll, expect, test } from "bun:test";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { OutputBody } from "./OutputDialog";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadProcessLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});
const html = (knowledge?: Parameters<typeof OutputBody>[0]["knowledge"]) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <OutputBody content="NOI-DUNG" knowledge={knowledge} />
    </I18nextProvider>,
  );

test("có knowledge ⇒ notice nằm sau <pre>", () => {
  const h = html({ write_to: null, queries: 3, query_limit: 5, warning: null, summary: "pending" });
  expect(h.indexOf("NOI-DUNG")).toBeLessThan(h.indexOf("Tri thức: 3/5 lần hỏi"));
});
test("knowledge vắng/null ⇒ không notice", () => {
  expect(html()).not.toContain("Tri thức");
  expect(html(undefined)).not.toContain("Tri thức");
});
