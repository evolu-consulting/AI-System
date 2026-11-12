// PK-FR-10 · TF5 · khung rỗng: chuông (S16) chưa có dữ liệu, khoang trợ lý (nội dung chờ HD6), VI nguyên văn.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { ConnectedBell } from "~/features/notifications/components/ConnectedBell";
import AssistantPanel from "../assistant/AssistantPanel";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("Shell · khung rỗng", () => {
  test("chuông: MỘT chuông web-kit (ConnectedBell) có nút 'Thông báo' đóng sẵn", () => {
    const html = renderToStaticMarkup(<ConnectedBell />);
    expect(html).toContain('aria-label="Thông báo"');
  });
  test("khoang trợ lý: tiêu đề + nút 'Thu gọn ›' khi gắn bên phải; sheet không có nút", () => {
    const docked = renderToStaticMarkup(
      <AssistantPanel onClose={() => {}} closeLabel="Thu gọn ›" />,
    );
    expect(docked).toContain("Trợ lý AI");
    expect(docked).toContain("Thu gọn ›");
    // M2-chat: sheet không có nút Thu gọn, nhưng có ô hỏi + gợi ý.
    const sheet = renderToStaticMarkup(<AssistantPanel onClose={() => {}} />);
    expect(sheet).not.toContain("Thu gọn");
    expect(sheet).toContain('aria-label="Câu hỏi cho trợ lý"');
    expect(sheet).toContain("Hợp đồng nào sắp hết hạn trong 60 ngày?");
  });
});
