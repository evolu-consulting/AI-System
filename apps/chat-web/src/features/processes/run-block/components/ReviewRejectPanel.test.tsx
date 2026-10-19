// N2-FR-02 · HD-FR-36 · ReviewRejectPanel: ô lý do bắt buộc + nút "Từ chối · kết thúc lượt chạy" (tắt khi trống); câu lỗi
// STARTER_CANNOT_REVIEW / FEEDBACK_REQUIRED có bản dịch riêng (không rơi về câu mạng).
import { beforeAll, expect, test } from "bun:test";
import { loadProcessLocale } from "@ai/i18n/process-locales";
import { ApiError } from "@ai/web-kit/http";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { reviewErrorMessage } from "../lib/review-error";
import { ReviewRejectPanel } from "./ReviewRejectPanel";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadProcessLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

test("ô lý do có nhãn; nút Từ chối tắt khi chưa nhập; có nút Huỷ", () => {
  const h = renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={new QueryClient()}>
        <ReviewRejectPanel
          runId="r"
          taskId="t"
          stage="Duyệt cấp 2"
          onDone={() => {}}
          onCancel={() => {}}
        />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  expect(h).toContain('aria-label="Lý do từ chối (bắt buộc)"');
  expect(h).toMatch(/<button[^>]*disabled=""[^>]*>Từ chối · kết thúc lượt chạy<\/button>/);
  expect(h).toContain(">Huỷ<");
});

test("lỗi engine của Từ chối có câu riêng", () => {
  const t = i18n.t.bind(i18n);
  const e = (code: string) => new ApiError(403, code as never, "raw");
  expect(reviewErrorMessage(e("STARTER_CANNOT_REVIEW"), t)).toBe(
    "Bạn là người bắt đầu lượt chạy nên không thể duyệt bước này.",
  );
  expect(reviewErrorMessage(e("FEEDBACK_REQUIRED"), t)).toBe("Nhập lý do trước khi gửi.");
});
