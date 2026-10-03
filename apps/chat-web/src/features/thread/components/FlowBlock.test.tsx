// CHAT-AC-05, CHAT-AC-06 · khối flow: article "Flow: …", Consultant + logo, footer "+N tin", nút Trả lời tiếp, con trỏ khi stream.
import { beforeAll, expect, test } from "bun:test";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { AnswerView } from "../lib/thread-logic";
import { FlowBlock, type FlowBlockProps } from "./FlowBlock";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const answer = (over: Partial<AnswerView> = {}): AnswerView => ({
  text: "Kính gửi Quý khách",
  streaming: false,
  waiting: false,
  cold: false,
  ask: null,
  error: null,
  cancelled: false,
  ...over,
});

const render = (over: Partial<FlowBlockProps> = {}) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FlowBlock
        title="Email báo giá"
        flowId="f1"
        runId={null}
        question="Soạn email báo giá"
        answer={answer()}
        footer={{
          copyValue: "x",
          messageCount: 4,
          timeLabel: "2 phút trước",
          openHere: false,
          busy: false,
          onReply: () => {},
        }}
        {...over}
      />
    </I18nextProvider>,
  );

test("article + Consultant + footer +N tin + Trả lời tiếp", () => {
  const html = render();
  expect(html).toContain('aria-label="Flow: Email báo giá"');
  expect(html).toContain('data-flow-id="f1"');
  expect(html).toContain("Consultant");
  expect(html).toContain('alt="EvoluConsulting"');
  expect(html).toContain("+2 tin trong flow · 2 phút trước");
  expect(html).toContain("Trả lời tiếp");
  expect(html).toContain("Copy");
  expect(html).not.toContain("animate-pulse");
});

test("đang stream: con trỏ aria-hidden + data-run-id", () => {
  const html = render({ runId: "r1", answer: answer({ streaming: true }) });
  expect(html).toContain('data-run-id="r1"');
  expect(html).toContain("animate-pulse");
  expect(html).toContain('aria-busy="true"');
});

test("lỗi đã lưu: alert theo mã, không hiện message thô", () => {
  const html = render({ answer: answer({ error: { code: "TIMEOUT", runId: "r1" } }) });
  expect(html).toContain('role="alert"');
  expect(html).toContain("Hệ thống xử lý quá lâu");
  expect(html).toContain("TIMEOUT · run r1");
});

test("chưa có trả lời: không Consultant; flow chưa có → Trả lời tiếp disabled", () => {
  const html = render({
    answer: null,
    footer: { copyValue: "", messageCount: 0, timeLabel: null, openHere: false, busy: false },
  });
  expect(html).not.toContain("Consultant");
  expect(html).toMatch(/disabled=""[^>]*>Trả lời tiếp/);
});
