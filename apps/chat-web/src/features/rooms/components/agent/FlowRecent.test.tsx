// CR-050 · FlowRecent (render tĩnh): ≤ 3 comment, tên agent theo ngôn ngữ, chưa xem có data-unread + "Chưa xem", đếm "mới".
import { beforeAll, describe, expect, test } from "bun:test";
import type { RoomMessage } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { FlowRecent } from "./FlowRecent";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AT = "2026-10-08T01:00:00.000Z";
const flow: NonNullable<RoomMessage["flow"]> = {
  message_count: 5,
  last_active_at: AT,
  unread: 2,
  recent: [
    {
      id: uid(1),
      seq: 4,
      sender_type: "user",
      sender: { id: uid(10), display_name: "Edgar Nguyen" },
      preview: "HD-15 xong chiều nay",
      created_at: AT,
      unread: false,
    },
    {
      id: uid(2),
      seq: 5,
      sender_type: "agent",
      sender: { id: uid(11), display_name: "Trello" },
      agent: { key: "trello", name: { vi: "Trello VN", en: "Trello" } },
      preview: "Đã giao OPS-7",
      created_at: AT,
      unread: true,
    },
  ],
};
const render = (f: NonNullable<RoomMessage["flow"]>, onOpen?: () => void) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <FlowRecent flow={f} onOpen={onOpen} />
    </I18nextProvider>,
  );

describe("FlowRecent", () => {
  test("tiêu đề + đếm mới; dòng chưa xem có data-unread + 'Chưa xem'; agent dùng tên theo ngôn ngữ", () => {
    const html = render(flow, () => {});
    expect(html).toContain('aria-label="Bình luận gần nhất trong thread"');
    expect(html).toContain("Trong thread");
    expect(html).toContain("2 mới");
    expect(html).toContain("Trello VN");
    expect(html).toContain("Edgar Nguyen");
    expect(html.match(/data-unread="true"/g)?.length).toBe(1);
    expect(html).toContain("Chưa xem");
  });
  test("không có recent → không render; không onOpen → nút disabled", () => {
    expect(render({ message_count: 0, last_active_at: AT })).toBe("");
    expect(render(flow)).toContain("disabled");
  });
});
