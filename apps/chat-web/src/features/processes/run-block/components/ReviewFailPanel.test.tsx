// CHAT-AC-60 · HUB-FR-118 · ReviewFailPanel: radiogroup "Chưa đạt thì…", mặc định "Làm lại giai đoạn này", tuỳ chọn mỗi đích, textbox Góp ý.
import { beforeAll, expect, test } from "bun:test";
import type { TaskDetail } from "@ai/contracts/chat";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { ReviewFailPanel } from "./ReviewFailPanel";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadProcessLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const task = (o: Partial<TaskDetail> = {}): TaskDetail => ({
  id: "00000000-0000-4000-8000-000000000001",
  kind: "review",
  status: "open",
  stage_idx: 2,
  stage_name: "Test hồi quy",
  forwards: [],
  can_act: true,
  created_at: "2026-10-10T00:00:00.000Z",
  back_steps: [0],
  back_rounds_left: 3,
  ...o,
});
const render = (t: TaskDetail, names?: (s: number) => string) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <ReviewFailPanel
          runId="r"
          task={t}
          stageNames={names}
          agent="Agent"
          left={2}
          onSent={() => {}}
          onCancel={() => {}}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );

test("radiogroup có 'Làm lại giai đoạn này' (chọn sẵn) + 'Quay lại bước 1'; gợi ý tên giai đoạn; ô Góp ý; nút Gửi chưa đạt", () => {
  const h = render(task(), () => "Phân tích");
  expect(h).toContain('role="radiogroup"');
  expect(h).toContain('aria-label="Chưa đạt thì…"');
  expect(h).toContain("Làm lại giai đoạn này");
  expect(h).toContain("Quay lại bước 1");
  expect(h).toContain("Chạy lại: Phân tích");
  expect(h).toContain('aria-label="Góp ý"');
  expect(h).toContain("Gửi chưa đạt");
  expect(h).toMatch(/aria-checked="true"[^>]*value="redo"|value="redo"[^>]*aria-checked="true"/);
  expect(h).not.toContain('role="note"');
});

test("hết lượt (back_rounds_left=0) ⇒ radio quay lại vẫn hiện", () => {
  const h = render(task({ back_rounds_left: 0 }));
  expect(h).toContain("Quay lại bước 1");
});
