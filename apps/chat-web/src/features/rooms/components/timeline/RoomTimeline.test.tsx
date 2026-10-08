// HUB-FR-96, HUB-FR-100 · RoomTimeline (render tĩnh): log, tin mình/người khác, tên chỉ ở nhóm, "Đã xem", @ nguyên chữ, tin agent (X2b).
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
});

test("X2b · tin agent → AgentBlock theo caller của lượt; run đang chạy → khối chờ cuối timeline", () => {
  const agent = { key: "hoadon", name: { vi: "Hoá đơn", en: "Invoices" } };
  const flow = "00000000-0000-4000-8000-000000000301";
  const m: RoomMessage = {
    ...msg(3, THU, "HD-12 hợp lệ.", "agent"),
    agent,
    caller: { id: THU, display_name: "Thu Hà" },
    run_id: flow,
    flow_id: flow,
    steps: { count: 2, ms: 1500 },
  };
  const run = {
    run_id: "00000000-0000-4000-8000-000000000302",
    flow_id: flow,
    trigger_message_id: flow,
    agent,
    caller: { id: THU, display_name: "Thu Hà" },
    status: "running" as const,
    started_at: "2026-10-01T09:16:00.000Z",
  };
  const html = render({ messages: [m], pending: [run] });
  expect(html).toContain('aria-label="Trả lời của agent Hoá đơn"');
  expect(html).toContain("HD-12 hợp lệ.");
  expect(html).toContain("Thu Hà hỏi");
  expect(html).toContain("Chạy bằng quyền của Thu Hà");
  expect(html).toContain("2 bước · 1.5s");
  expect(html).toContain("Trả lời tiếp");
  expect(html).toContain("Hoá đơn đang xử lý…");
  expect(html).toContain("Chỉ Thu Hà dừng được");
  expect(html).not.toContain(">Dừng<");
  expect(html.indexOf("HD-12")).toBeLessThan(html.indexOf("đang xử lý"));
});

test('X2b · lượt của mình: "Bạn hỏi", nút Dừng; run lỗi/huỷ → câu chung', () => {
  const base = {
    ...msg(4, THU, "lỗi nội bộ quota", "agent"),
    caller: { id: ME, display_name: "Lan Trần" },
  };
  const failed = render({ messages: [{ ...base, run_status: "failed" }] });
  expect(failed).toContain("Bạn hỏi");
  expect(failed).toContain("Chạy bằng quyền của bạn");
  expect(failed).toContain("Orchestrator");
  expect(failed).toContain("Agent không trả lời được. Thử hỏi lại sau.");
  expect(failed).not.toContain("quota");
  const cancelled = render({ messages: [{ ...base, run_status: "cancelled" }] });
  expect(cancelled).toContain("Đã huỷ");
  const run = {
    run_id: "00000000-0000-4000-8000-000000000303",
    flow_id: "00000000-0000-4000-8000-000000000304",
    trigger_message_id: "00000000-0000-4000-8000-000000000305",
    agent: null,
    caller: { id: ME, display_name: "Lan Trần" },
    status: "running" as const,
    started_at: "2026-10-01T09:16:00.000Z",
  };
  const mine = render({ messages: [], pending: [run] });
  expect(mine).toContain(">Dừng<");
  expect(mine).not.toContain("dừng được");
});
