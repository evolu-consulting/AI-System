// PK-FR-10 · TF5 · khung rỗng: chuông (S16) chưa có dữ liệu, khoang trợ lý (nội dung chờ HD6), VI nguyên văn.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import AssistantPanel from "../assistant/AssistantPanel";
import { NotificationBell } from "./NotificationBell";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("Shell · khung rỗng", () => {
  test("chuông: nút 'Thông báo' (đóng sẵn); có chưa đọc ⇒ nhãn kèm số và chấm số", () => {
    expect(renderToStaticMarkup(<NotificationBell />)).toContain('aria-label="Thông báo"');
    const html = renderToStaticMarkup(<NotificationBell unread={12} />);
    expect(html).toContain("Thông báo, 12 chưa đọc");
    expect(html).toContain("9+");
  });
  test("khoang trợ lý: tiêu đề + nút 'Thu gọn ›' khi gắn bên phải; sheet không có nút", () => {
    const docked = renderToStaticMarkup(
      <AssistantPanel onClose={() => {}} closeLabel="Thu gọn ›" />,
    );
    expect(docked).toContain("Trợ lý AI");
    expect(docked).toContain("Thu gọn ›");
    expect(renderToStaticMarkup(<AssistantPanel onClose={() => {}} />)).not.toContain("<button");
  });
});
