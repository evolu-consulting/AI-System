// HUB-FR-96, HUB-FR-100 · RoomTimeline (render tĩnh): log, tin mình/người khác, tên chỉ ở nhóm, "Đã xem", @ nguyên chữ, agent bị bỏ.
import { beforeAll, describe, expect, test } from "bun:test";
import type { RoomMember, RoomMessage } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { RoomTimeline } from "./RoomTimeline";

let i18n: I18n;
beforeAll(async () => {
  i18n = createInstance();
  await i18n.use(initReactI18next).init({
    lng: "vi",
    resources: { vi: { translation: await loadChatLocale("vi") } },
    interpolation: { escapeValue: false },
  });
});

const ME = "00000000-0000-4000-8000-000000000001";
const THU = "00000000-0000-4000-8000-000000000002";
const msg = (
  seq: number,
  sender: string,
  content: string,
  type: "user" | "agent" = "user",
): RoomMessage => ({
  id: `00000000-0000-4000-8000-0000000002${String(seq).padStart(2, "0")}`,
  room_id: ME,
  seq,
  sender_type: type,
  sender: { id: sender, display_name: sender === ME ? "Lan Trần" : "Thu Hà" },
  content,
  client_msg_id: null,
  created_at: "2026-10-01T09:15:00.000Z",
});
const reader = { id: THU, display_name: "Thu Hà" } as RoomMember;

function render(over: Partial<Parameters<typeof RoomTimeline>[0]> = {}) {
  const messages = [msg(1, THU, "chào @lan"), msg(2, ME, "ok nhé")];
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RoomTimeline
        messages={messages}
        myId={ME}
        group
        seen={{ messageId: messages[1]?.id ?? null, readers: [reader] }}
        hasOlder={false}
        loadingOlder={false}
        scrollRef={createRef<HTMLDivElement>()}
        contentRef={createRef<HTMLDivElement>()}
        onScroll={() => {}}
        {...over}
      />
    </I18nextProvider>,
  );
}

describe("RoomTimeline", () => {
  test("role=log có nhãn, mỗi tin là article có data-seq", () => {
    const html = render();
    expect(html).toContain('role="log"');
    expect(html).toContain('aria-label="Tin nhắn của phòng"');
    expect(html).toContain('data-seq="1"');
    expect(html).toContain('data-seq="2"');
  });
  test("tin mình ghi 'Bạn', người khác ghi tên (nhóm)", () => {
    const html = render();
    expect(html).toMatch(/aria-label="Bạn, \d\d:\d\d"/);
    expect(html).toMatch(/aria-label="Thu Hà, \d\d:\d\d"/);
  });
  test("DM: không in tên người khác trong thân tin", () => {
    const html = render({ group: false });
    expect(html).not.toContain("Thu Hà ·");
  });
  test("@xxx hiện nguyên chữ, không link", () => {
    const html = render();
    expect(html).toContain("chào @lan");
    expect(html).not.toContain("<a ");
  });
  test("'Đã xem' (nhóm: 'Đã xem bởi n' + tên ở title)", () => {
    const html = render();
    expect(html).toContain("Đã xem bởi 1");
    expect(html).toContain('title="Thu Hà"');
    expect(render({ group: false })).toContain(">Đã xem<");
  });
  test("không ai đọc: không có status", () => {
    expect(render({ seen: { messageId: null, readers: [] } })).not.toContain('role="status"');
  });
  test("rỗng: câu mời gửi tin; hết tin cũ: 'Đầu cuộc trò chuyện'", () => {
    expect(render({ messages: [], seen: { messageId: null, readers: [] } })).toContain(
      "Chưa có tin nào",
    );
    expect(render()).toContain("Đầu cuộc trò chuyện");
    expect(render({ hasOlder: true })).not.toContain("Đầu cuộc trò chuyện");
  });
  test("tin của agent không dựng ở X2a", () => {
    const html = render({ messages: [msg(3, THU, "bot says", "agent")] });
    expect(html).not.toContain("bot says");
  });
});
