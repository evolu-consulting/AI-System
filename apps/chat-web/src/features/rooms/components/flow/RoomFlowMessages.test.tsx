// HUB-FR-101, HUB-FR-103 · X2b D10: thread chung — tin người luôn ghi tên người gửi, khối agent ghi "<B> hỏi" +
// "Chạy bằng quyền của <B>" theo từng lượt, không có chân "Trả lời tiếp" trong khung.
import { beforeAll, expect, test } from "bun:test";
import type { RoomMessage } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { RoomFlowMessages } from "./RoomFlowMessages";

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
const LAN = uid(1);
const THU = uid(2);
const AT = "2026-10-08T01:00:00.000Z";
const human: RoomMessage = {
  id: uid(10),
  room_id: uid(9),
  seq: 1,
  sender_type: "user",
  sender: { id: THU, display_name: "Thu Ha" },
  content: "Mình xem rồi, ok nhé",
  client_msg_id: null,
  created_at: AT,
  flow_id: uid(30),
  placement: "flow",
};
const agent: RoomMessage = {
  ...human,
  id: uid(11),
  seq: 2,
  sender_type: "agent",
  sender: { id: uid(50), display_name: "hoadon" },
  content: "HD-13 hợp lệ.",
  run_id: uid(20),
  trigger_message_id: uid(10),
  agent: { key: "hoadon", name: { vi: "hoadon", en: "hoadon" } },
  caller: { id: THU, display_name: "Thu Ha" },
  run_status: "finished",
};

const render = (myId: string) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <RoomFlowMessages
        messages={[human, agent]}
        myId={myId}
        loading={false}
        hasOlder={false}
        loadOlder={() => {}}
        pending={[]}
        waiting={new Set()}
        onAnswer={async () => true}
        onRerun={() => {}}
      />
    </I18nextProvider>,
  );

test("người khác: tên người gửi + '<B> hỏi' + 'Chạy bằng quyền của <B>', không 'Trả lời tiếp'", () => {
  const h = render(LAN);
  expect(h).toContain('role="log"');
  expect(h).toContain("Thu Ha · ");
  expect(h).toContain("Thu Ha hỏi");
  expect(h).toContain("Chạy bằng quyền của Thu Ha");
  expect(h).toContain('aria-label="Trả lời của agent hoadon"');
  expect(h).not.toContain("Trả lời tiếp");
});

test("người gửi lượt: 'Bạn · …', 'Bạn hỏi', 'Chạy bằng quyền của bạn'", () => {
  const h = render(THU);
  expect(h).toContain("Bạn · ");
  expect(h).toContain("Bạn hỏi");
  expect(h).toContain("Chạy bằng quyền của bạn");
});
