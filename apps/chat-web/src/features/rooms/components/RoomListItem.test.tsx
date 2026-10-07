// HUB-FR-96, HUB-FR-100 · RoomListItem (render tĩnh): tên, xem trước, huy hiệu, aria-current.
import { beforeAll, describe, expect, test } from "bun:test";
import type { RoomSummary } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { RoomListItem } from "./RoomListItem";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const ME = "22222222-2222-4222-8222-222222222222";
const room: RoomSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "group",
  name: "Dự án Minh Phát",
  peer: null,
  member_count: 3,
  my_role: "member",
  last_message: {
    seq: 4,
    sender_type: "user",
    sender: { id: "33333333-3333-4333-8333-333333333333", display_name: "Thu Hà" },
    preview: "Chốt nhé",
    created_at: "2026-10-01T00:00:00.000Z",
  },
  last_seq: 4,
  unread: 3,
  last_activity_at: "2026-10-01T00:00:00.000Z",
};
const render = (r: RoomSummary, active = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RoomListItem room={r} myId={ME} active={active} onOpen={() => {}} />
    </I18nextProvider>,
  );

describe("RoomListItem", () => {
  test("link tới phòng, tên + xem trước người khác, huy hiệu số", () => {
    const html = render(room);
    expect(html).toContain('href="/rooms/11111111-1111-4111-8111-111111111111"');
    expect(html).toContain("Dự án Minh Phát");
    expect(html).toContain("Thu Hà: Chốt nhé");
    expect(html).toContain('data-testid="unread-badge"');
    expect(html).toContain("3 tin chưa đọc");
    expect(html).not.toContain("aria-current");
  });
  test("không chưa đọc → không huy hiệu; đang mở → aria-current; tin của mình → Bạn:", () => {
    const mine = {
      ...room,
      unread: 0,
      last_message: room.last_message && {
        ...room.last_message,
        sender: { id: ME, display_name: "Tôi" },
      },
    };
    const html = render(mine, true);
    expect(html).not.toContain("unread-badge");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Bạn: Chốt nhé");
  });
  test("DM lấy tên người kia", () => {
    const dm: RoomSummary = {
      ...room,
      kind: "dm",
      name: null,
      peer: {
        id: "44444444-4444-4444-8444-444444444444",
        display_name: "Lan Trần",
        username: "lan",
      },
    };
    expect(render(dm)).toContain("Lan Trần");
  });
});
