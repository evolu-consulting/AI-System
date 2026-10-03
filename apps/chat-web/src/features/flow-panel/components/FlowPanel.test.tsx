// CHAT-AC-14, CHAT-AC-16 · khung flow: aside "Flow đang mở", header "{n} tin · nhớ cả flow" + ✕, Consultant, ô nhập trong flow, cold.
import { beforeAll, expect, test } from "bun:test";
import type { Flow } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import type { AnswerView } from "~/features/thread/lib/thread-logic";
import type { FlowPanelData } from "../hooks/use-flow-panel";
import { FlowPanel } from "./FlowPanel";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const flow = { id: "f1", title: "Email báo giá Minh Phát", message_count: 4 } as Flow;

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

const data = (over: Partial<FlowPanelData> = {}): FlowPanelData => ({
  items: [
    { kind: "question", id: "m1", text: "Soạn email báo giá" },
    { kind: "answer", id: "m2", answer: answer() },
  ],
  loading: false,
  hasOlder: false,
  loadOlder: () => {},
  pendingQuestion: null,
  pendingAnswer: null,
  composer: { running: false, locked: false, onSubmit: async () => true, onStop: () => {} },
  ...over,
});

const render = (d: FlowPanelData) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FlowPanel convId="c1" flow={flow} data={d} onClose={() => {}} />
    </I18nextProvider>,
  );

test("aside 'Flow đang mở' + header + tin + ô nhập trong flow", () => {
  const html = render(data());
  expect(html).toContain('<aside aria-label="Flow đang mở"');
  expect(html).toContain("Email báo giá Minh Phát");
  expect(html).toContain("4 tin · nhớ cả flow");
  expect(html).toContain('aria-label="Đóng khung flow"');
  expect(html).toContain("Consultant");
  expect(html).toContain('aria-label="Tin nhắn trong flow"');
  expect(html).toContain('aria-label="Gửi trong flow"');
  expect(html).not.toContain("Thu nhỏ flow");
});

test("run gửi trong flow ở flow nghỉ → câu hỏi chờ + 'Đang mở lại flow…'", () => {
  const html = render(
    data({
      pendingQuestion: "Đối chiếu tiếp",
      pendingAnswer: answer({ text: "", streaming: true, waiting: true, cold: true }),
    }),
  );
  expect(html).toContain("Đối chiếu tiếp");
  expect(html).toContain('role="status"');
  expect(html).toContain("Đang mở lại flow, lần đầu có thể mất vài giây…");
});
