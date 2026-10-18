// HUB-FR-146 · P-d2 · UAT B-D2-1: ô `number` là ô chữ (không bong bóng gốc Chromium) + câu i18n khi `numberInvalid`.
import { beforeAll, expect, test } from "bun:test";
import type { ProcessInputDef } from "@ai/contracts/hub-admin";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { InputField } from "./InputField";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadProcessLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const def = { key: "so_tien", type: "number", label: "Số tiền", required: true } as ProcessInputDef;
const html = (error?: "numberInvalid") =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <InputField
        def={def}
        value={{ value: "1e", fileName: "", branch: "" }}
        error={error}
        file={{ uploading: false, failed: false }}
        chips={{ status: "idle" } as never}
        disabled={false}
        onChange={() => {}}
        onSource={() => {}}
        onFile={() => {}}
      />
    </I18nextProvider>,
  );

test("ô number không dùng type=number (tránh validate gốc), có inputMode decimal", () => {
  const h = html();
  expect(h).toContain('<input type="text"');
  expect(h).toContain('inputMode="decimal"');
});

test("numberInvalid ⇒ role=alert 'Nhập một số hợp lệ.'; không lỗi ⇒ không alert", () => {
  expect(html("numberInvalid")).toContain("Nhập một số hợp lệ.");
  expect(html()).not.toContain('role="alert"');
});
