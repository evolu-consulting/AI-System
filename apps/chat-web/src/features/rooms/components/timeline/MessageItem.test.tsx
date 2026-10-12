// HUB-FR-44 · X2b-2 F2 (D5): tin người có tệp → AttachmentList trong bong bóng; không tệp → không danh sách.
import { beforeAll, expect, test } from "bun:test";
import type { RoomMessage } from "@ai/contracts/chat";
import { loadChatLocale } from "@ai/i18n/chat-locales";
import { createInstance, type i18n as I18n } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider, initReactI18next } from "react-i18next";
import { MessageItem } from "./MessageItem";

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
const base: RoomMessage = {
  id: uid(10),
  room_id: uid(9),
  seq: 1,
  sender_type: "user",
  sender: { id: uid(1), display_name: "Lan Tran" },
  content: "Xem giúp",
  client_msg_id: null,
  created_at: "2026-10-08T01:00:00.000Z",
};
const html = (m: RoomMessage, mine = false) =>
  renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <MessageItem message={m} mine={mine} group />
    </I18nextProvider>,
  );

test("tin có tệp: chip tải theo tên; tệp không còn → aria-disabled", () => {
  const h = html({
    ...base,
    attachments: [
      { id: uid(21), filename: "hd.pdf", mime: "application/pdf", size: 2048, available: true },
      { id: uid(22), filename: "cu.txt", mime: "text/plain", size: 10, available: false },
    ],
  });
  expect(h).toContain("hd.pdf");
  expect(h).toContain("cu.txt");
  expect(h).toContain('aria-disabled="true"');
});

test("tin không tệp (hoặc mảng rỗng): không có danh sách tệp", () => {
  expect(html(base)).not.toContain("<ul");
  expect(html({ ...base, attachments: [] }, true)).not.toContain("<ul");
});
