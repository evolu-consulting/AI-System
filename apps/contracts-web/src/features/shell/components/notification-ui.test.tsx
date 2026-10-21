// N3-FR-04 · N3-FR-09 · phần trình bày của chuông: danh sách (chưa đọc đậm + chấm; VI nguyên văn).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { NotificationItems } from "./NotificationItems";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const n = (o: Partial<Parameters<typeof NotificationItems>[0]["items"][number]> = {}) => ({
  id: "a1000000-0000-4000-8000-000000000001",
  seq: 2,
  source: "contracts",
  kind: "remind.deadline",
  title: "Hợp đồng sắp hết hạn",
  body: "Còn 30 ngày",
  link: null,
  created_at: "2026-10-18T02:00:00.000Z",
  read: false,
  ...o,
});

describe("NotificationItems", () => {
  test("chưa đọc: tiêu đề đậm + chấm 'Chưa đọc'; đã đọc: không chấm, không đậm", () => {
    const unread = renderToStaticMarkup(<NotificationItems items={[n()]} />);
    expect(unread).toContain("Hợp đồng sắp hết hạn");
    expect(unread).toContain("Còn 30 ngày");
    expect(unread).toContain('aria-label="Chưa đọc"');
    expect(unread).toContain("font-semibold");
    const read = renderToStaticMarkup(<NotificationItems items={[n({ read: true })]} />);
    expect(read).not.toContain("Chưa đọc");
    expect(read).not.toContain("font-semibold");
  });
  test("thân rỗng không in dòng thân; mọi hàng nằm trong danh sách", () => {
    const html = renderToStaticMarkup(
      <NotificationItems
        items={[n({ body: "" }), n({ id: "a1000000-0000-4000-8000-000000000002" })]}
      />,
    );
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).not.toContain('line-clamp-2"></span>');
  });
});
