// HUB-FR-44 · HUB-FR-101 · X2b2-R04, R16, D13 · contract `@ai/contracts/chat` khối X2b-2 chỉ thêm (plan §2, test-plan X2b2 §2
// K1–K5). Nạp động (trường mới chưa có ⇒ strict từ chối ⇒ đỏ ở expect). K5 xanh trước code (bảo toàn mã lỗi X2a R24).
import { describe, expect, it } from "bun:test";
import { loadChat } from "../_modules";

const U = (n: number) => `a2b20000-0000-4000-8000-${String(70_000 + n).padStart(12, "0")}`;
const AT = "2026-10-12T01:00:00.000Z";
const ok = (s: { safeParse?: (v: unknown) => { success: boolean } } | undefined, v: unknown) => {
  expect(typeof s?.safeParse).toBe("function");
  return s?.safeParse?.(v).success;
};
const base = { content: "đây là hoá đơn", client_msg_id: U(1) };
const ref = (n: number) => ({
  id: U(100 + n),
  filename: `tep-${n}.pdf`,
  mime: "application/pdf",
  size: 1_048_576,
  available: true,
});
const msg = {
  id: U(2),
  room_id: U(3),
  seq: 7,
  sender_type: "user",
  sender: { id: U(4), display_name: "Lan" },
  content: "đây là hoá đơn",
  client_msg_id: U(1),
  created_at: AT,
};
const ten = Array.from({ length: 10 }, (_, i) => U(10 + i));

describe("X2b2 C-1 · SendRoomMessageRequest.attachment_ids [plan §2, R04]", () => {
  it("HUB-FR-44 · X2b2-AC01 · K1 · attachment_ids 1 id / 10 id (kèm flow_id) ⇒ pass", async () => {
    const c = await loadChat();
    expect(ok(c.SendRoomMessageRequestSchema, { ...base, attachment_ids: [U(10)] })).toBe(true);
    expect(ok(c.SendRoomMessageRequestSchema, { ...base, attachment_ids: ten })).toBe(true);
    expect(
      ok(c.SendRoomMessageRequestSchema, { ...base, flow_id: U(5), attachment_ids: [U(10)] }),
    ).toBe(true);
  });

  it("HUB-FR-44 · X2b2-AC05 · K2 · 11 id / trùng / [] / không uuid / content rỗng + id ⇒ fail; trùng ⇒ message 'duplicate'", async () => {
    const c = await loadChat();
    const S = c.SendRoomMessageRequestSchema;
    expect(ok(S, { ...base, attachment_ids: [U(10)] })).toBe(true); // đối chứng: trường đã có
    const eleven = Array.from({ length: 11 }, (_, i) => U(10 + i));
    expect(ok(S, { ...base, attachment_ids: eleven })).toBe(false);
    expect(ok(S, { ...base, attachment_ids: [] })).toBe(false);
    expect(ok(S, { ...base, attachment_ids: ["khong-phai-uuid"] })).toBe(false);
    expect(ok(S, { ...base, content: "", attachment_ids: [U(10)] })).toBe(false);
    const dup = S.safeParse({ ...base, attachment_ids: [U(10), U(10)] });
    expect(dup.success).toBe(false);
    expect(JSON.stringify(dup.error?.issues ?? [])).toContain("duplicate");
    // G7: trùng khác hoa/thường zod KHÔNG bắt (server chuẩn hoá ⇒ 400, kiểm ở int I17)
  });
});

describe("X2b2 C-2 · RoomMessage.attachments [plan §2, R16, C-4]", () => {
  it("HUB-FR-44 · X2b2-R16 · K3 · 1…10 AttachmentRef pass; 11 / [] / khoá lạ trong ref ⇒ fail; vắng ⇒ pass", async () => {
    const c = await loadChat();
    const S = c.RoomMessageSchema;
    expect(ok(S, msg)).toBe(true);
    expect(ok(S, { ...msg, attachments: [ref(1)] })).toBe(true);
    expect(ok(S, { ...msg, attachments: Array.from({ length: 10 }, (_, i) => ref(i)) })).toBe(true);
    expect(ok(S, { ...msg, attachments: [{ ...ref(1), available: false }] })).toBe(true);
    expect(ok(S, { ...msg, attachments: Array.from({ length: 11 }, (_, i) => ref(i)) })).toBe(
      false,
    );
    expect(ok(S, { ...msg, attachments: [] })).toBe(false);
    expect(ok(S, { ...msg, attachments: [{ ...ref(1), storage_key: "x/y" }] })).toBe(false);
    const agentMsg = { ...msg, id: U(6), sender_type: "agent", content: "Báo cáo đã ghi." };
    expect(ok(S, { ...agentMsg, attachments: [ref(2)] })).toBe(true);
    expect(
      ok(c.RoomMessagePageSchema, { items: [{ ...msg, attachments: [ref(1)] }], has_more: false }),
    ).toBe(true);
  });

  it("HUB-FR-44 · X2b2-AC14 · K4 · parseMeStreamEvent room.message có attachments ⇒ parse được, giữ mảng", async () => {
    const c = await loadChat();
    expect(typeof c.parseMeStreamEvent).toBe("function");
    const data = { room_id: msg.room_id, message: { ...msg, attachments: [ref(1), ref(2)] } };
    const ev = c.parseMeStreamEvent("room.message", JSON.stringify(data));
    expect(ev).not.toBeNull();
    expect(ev?.data?.message?.attachments).toEqual([ref(1), ref(2)]);
  });
});

describe("D13 · không mã lỗi mới [X2a R24]", () => {
  it("HUB-FR-44 · X2b2-AC13 · K5 · CHAT_ATTACHMENT_ERRORS / CHAT_ROOM_ERRORS / CHAT_ROOM_AGENT_ERRORS y nguyên (xanh trước code)", async () => {
    const c = await loadChat();
    expect(c.CHAT_ATTACHMENT_ERRORS).toEqual({
      ATTACHMENT_NOT_FOUND: 404,
      ATTACHMENT_QUOTA_EXCEEDED: 409,
      ATTACHMENT_TOO_LARGE: 413,
      ATTACHMENT_TYPE_NOT_ALLOWED: 415,
    });
    expect(c.CHAT_ROOM_ERRORS).toEqual({
      ROOM_NOT_FOUND: 404,
      USER_NOT_FOUND: 404,
      NOT_ROOM_OWNER: 403,
      DM_IMMUTABLE: 409,
      ROOM_FULL: 409,
      OWNER_MUST_TRANSFER: 409,
      GROUP_NOT_HIDEABLE: 409,
      DM_SELF: 400,
    });
    expect(c.CHAT_ROOM_AGENT_ERRORS).toEqual({ NOT_RUN_CALLER: 403 });
  });
});
