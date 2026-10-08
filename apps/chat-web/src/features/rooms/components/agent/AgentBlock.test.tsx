// HUB-FR-101 · X2b F3 (§4 chờ, Q5): người gửi lượt thấy AskCard + chip; người khác câu hỏi (need_input) + WaitingNote,
// `side_effect` chỉ WaitingNote (không mô tả, nhãn "đang chờ xác nhận"); "Chạy lại" chỉ người gửi lượt.
import { beforeAll, expect, test } from "bun:test";
import type { RoomMessage } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { AgentBlock } from "./AgentBlock";

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
const base: RoomMessage = {
  id: uid(10),
  room_id: uid(9),
  seq: 3,
  sender_type: "agent",
  sender: { id: uid(50), display_name: "hoadon" },
  content: "Nội dung",
  client_msg_id: null,
  created_at: "2026-10-08T01:00:00.000Z",
  run_id: uid(20),
  flow_id: uid(30),
  trigger_message_id: uid(11),
  agent: { key: "hoadon", name: { vi: "hoadon", en: "hoadon" } },
  caller: { id: LAN, display_name: "Lan Tran" },
  run_status: "finished",
};
const answer = async () => true;
const html = (m: RoomMessage, myId: string, waiting = true, extra = {}) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <AgentBlock message={m} myId={myId} waiting={waiting} onAnswer={answer} {...extra} />
    </I18nextProvider>,
  );

const needInput = {
  ...base,
  ask: { kind: "need_input" as const, question: "Số hoá đơn nào?", choices: ["HD-12"] },
};

test("need_input: người gửi lượt thấy vùng 'cần thêm thông tin' + chip bật", () => {
  const h = html(needInput, LAN);
  expect(h).toContain(">HD-12<");
  expect(h).toContain('aria-label="hoadon cần thêm thông tin"');
  expect(h).not.toMatch(/<button[^>]*disabled=""[^>]*>HD-12</);
});

test("need_input: người khác thấy câu hỏi, không chip, 'Đang chờ Lan Tran trả lời agent.'", () => {
  const h = html(needInput, THU);
  expect(h).toContain("Số hoá đơn nào?");
  expect(h).not.toContain("cần thêm thông tin");
  expect(h).not.toContain(">HD-12<");
  expect(h).toContain("Đang chờ Lan Tran trả lời agent.");
  expect(html(needInput, THU, false)).not.toContain("Đang chờ");
});

const count = (h: string, s: string) => h.split(s).length - 1;

test("need_input: câu hỏi trùng thân tin chỉ hiện một lần (UAT #10), cả người gọi lẫn người khác", () => {
  const m = { ...needInput, content: " Số hoá đơn nào? " };
  expect(count(html(m, LAN), "Số hoá đơn nào?")).toBe(1);
  expect(count(html(m, THU), "Số hoá đơn nào?")).toBe(1);
  expect(
    count(html({ ...needInput, content: "Cần thêm: số hoá đơn" }, LAN), "Số hoá đơn nào?"),
  ).toBe(1);
});

test("need_input hết chờ: chip vô hiệu với người gửi lượt", () => {
  expect(html(needInput, LAN, false)).toMatch(/<button[^>]*disabled=""[^>]*>HD-12</);
});

test("side_effect: người gửi lượt thấy 'cần bạn xác nhận' + Đồng ý/Huỷ", () => {
  const m = {
    ...base,
    content: "Tạo thẻ BÍ-MẬT",
    ask: { kind: "side_effect" as const, question: "Xác nhận?", choices: ["Đồng ý", "Huỷ"] },
  };
  const h = html(m, LAN);
  expect(h).toContain("hoadon cần bạn xác nhận trước khi thực hiện");
  expect(h).toContain(">Đồng ý<");
  expect(h).toContain(">Huỷ<");
});

test("side_effect: người khác chỉ WaitingNote, nhãn 'đang chờ xác nhận', không thân/mô tả", () => {
  const m = {
    ...base,
    content: "Agent cần người gọi xác nhận một thao tác.",
    ask: { kind: "side_effect" as const },
  };
  const h = html(m, THU);
  expect(h).toContain('aria-label="Agent hoadon đang chờ xác nhận"');
  expect(h).toContain("Đang chờ Lan Tran xác nhận — chỉ người hỏi mới bấm được.");
  expect(h).not.toContain("Agent cần người gọi");
  expect(h).not.toContain("Đồng ý");
});

test("lỗi/huỷ: 'Chạy lại' chỉ cho người gửi lượt", () => {
  const failed = { ...base, run_status: "failed" as const };
  const rerun = { onRerun: () => {} };
  expect(html(failed, LAN, false, rerun)).toContain("Chạy lại");
  expect(html(failed, THU, false, rerun)).not.toContain("Chạy lại");
  expect(html({ ...base, run_status: "cancelled" }, LAN, false, rerun)).toContain("Đã huỷ");
});

test("side_effect thiếu choices (bản riêng không có ask): người gửi lượt vẫn có Đồng ý/Huỷ", () => {
  const h = html({ ...base, ask: { kind: "side_effect" } }, LAN);
  expect(h).toContain(">Đồng ý<");
  expect(h).toContain(">Huỷ<");
});
