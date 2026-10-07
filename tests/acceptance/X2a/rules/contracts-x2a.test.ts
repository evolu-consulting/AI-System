// HUB-FR-96 · HUB-FR-99 · HUB-FR-100 · HUB-FR-102 · X2a-AC10 · X2a-AC11 · contract `@ai/contracts/chat` khối X2a (test-plan
// X2a §5.1 R24–R33; plan §2, §15). Nạp động (export X2a chưa có ⇒ `undefined` ⇒ đỏ ở expect). R25, R33 xanh trước code.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadChat } from "../_modules";
import { shapes } from "./_shape";

const U = (n: number) => `a2a00000-0000-4000-8000-${String(20_000 + n).padStart(12, "0")}`;
const AT = "2026-10-07T01:00:00.000Z";
/** safeParse; export chưa có ⇒ đỏ ở expect (không TypeError). */
const ok = (s: { safeParse?: (v: unknown) => { success: boolean } } | undefined, v: unknown) => {
  expect(typeof s?.safeParse).toBe("function");
  return s?.safeParse?.(v).success;
};

const userRef = { id: U(1), display_name: "Lan", username: "lan" };
const message = {
  id: U(2),
  room_id: U(3),
  seq: 1,
  sender_type: "user",
  sender: { id: U(1), display_name: "Lan" },
  content: "Xin chào",
  client_msg_id: U(4),
  created_at: AT,
};
const summaryGroup = {
  id: U(3),
  kind: "group",
  name: "Nhóm dự án",
  peer: null,
  member_count: 3,
  my_role: "owner",
  last_message: {
    seq: 1,
    sender_type: "user",
    sender: { id: U(1), display_name: "Lan" },
    preview: "Xin chào",
    created_at: AT,
  },
  last_seq: 1,
  unread: 0,
  last_activity_at: AT,
};
const summaryDm = { ...summaryGroup, kind: "dm", name: null, peer: userRef, my_role: null };

describe("R24–R25 · lỗi CHAT_ROOM_ERRORS [plan §2.1]", () => {
  it("HUB-FR-96 · R24 · CHAT_ROOM_ERRORS đúng 8 mã + HTTP; CHAT_ROOM_ERROR_CODES đủ 8 [X2a-R03…R11]", async () => {
    const c = await loadChat();
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
    expect([...(c.CHAT_ROOM_ERROR_CODES ?? [])].sort()).toEqual(
      Object.keys(c.CHAT_ROOM_ERRORS ?? {}).sort(),
    );
  });

  it("HUB-FR-96 · R24b · UserNotFoundDetailsSchema {user_ids 1–200}; RoomFullDetailsSchema {max: 50, requested} strict", async () => {
    const c = await loadChat();
    expect(ok(c.UserNotFoundDetailsSchema, { user_ids: [U(1)] })).toBe(true);
    expect(ok(c.UserNotFoundDetailsSchema, { user_ids: [] })).toBe(false);
    expect(ok(c.RoomFullDetailsSchema, { max: 50, requested: 51 })).toBe(true);
    expect(ok(c.RoomFullDetailsSchema, { max: 49, requested: 51 })).toBe(false);
    expect(ok(c.RoomFullDetailsSchema, { max: 50, requested: 51, x: 1 })).toBe(false);
  });

  it("HUB-FR-96 · R25 · khối lỗi phòng không trùng khoá với CHAT_API_ERRORS (VALIDATION_ERROR giữ ở C1, D1)", async () => {
    const c = await loadChat();
    const room = Object.keys(c.CHAT_ROOM_ERRORS ?? {});
    const apiKeys = Object.keys(c.CHAT_API_ERRORS);
    expect(room.filter((k) => apiKeys.includes(k))).toEqual([]);
    expect(c.CHAT_API_ERRORS.VALIDATION_ERROR).toBe(400);
  });
});

describe("R26–R30 · schema phòng + danh bạ [plan §2.2, §2.3]", () => {
  it("HUB-FR-102 · R26 · DirectoryUserSchema đúng 4 khoá; thêm email/role/tenant_id ⇒ fail (strict) [X2a-R22 · X2a-AC10]", async () => {
    const c = await loadChat();
    const u = { id: U(1), display_name: "Lan", username: "lan", active: true };
    expect(ok(c.DirectoryUserSchema, u)).toBe(true);
    for (const extra of [{ email: "a@b.c" }, { role: "member" }, { tenant_id: U(9) }])
      expect(ok(c.DirectoryUserSchema, { ...u, ...extra })).toBe(false);
    expect(ok(c.DirectoryResponseSchema, { items: [u] })).toBe(true);
    expect(c.DIRECTORY_LIMIT_DEFAULT).toBe(20);
    expect(c.DIRECTORY_LIMIT_MAX).toBe(50);
    expect(ok(c.DirectoryQuerySchema, { q: "lan", limit: "50" })).toBe(true);
    expect(ok(c.DirectoryQuerySchema, { limit: "51" })).toBe(false);
  });

  it("HUB-FR-96 · R27 · RoomSummarySchema: last_activity_at, last_seq, last_message.preview ≤ 120; content ⇒ fail; dm name null, group peer null", async () => {
    const c = await loadChat();
    expect(ok(c.RoomSummarySchema, summaryGroup)).toBe(true);
    expect(ok(c.RoomSummarySchema, summaryDm)).toBe(true);
    const withContent = {
      ...summaryGroup,
      last_message: { ...summaryGroup.last_message, content: "x" },
    };
    expect(ok(c.RoomSummarySchema, withContent)).toBe(false);
    const longPrev = {
      ...summaryGroup,
      last_message: { ...summaryGroup.last_message, preview: "a".repeat(121) },
    };
    expect(ok(c.RoomSummarySchema, longPrev)).toBe(false);
    const { last_activity_at: _drop, ...noAct } = summaryGroup;
    expect(ok(c.RoomSummarySchema, noAct)).toBe(false);
    expect(ok(c.RoomSummarySchema, { ...summaryGroup, last_message_at: AT })).toBe(false);
    expect(ok(c.RoomListResponseSchema, { items: [], next_cursor: null, unread_total: 0 })).toBe(
      true,
    );
  });

  it("HUB-FR-96 · R28 · RoomMessageSchema: client_msg_id nullable; run_id/flow_id/trigger_message_id optional; sender_type ∈ user/agent", async () => {
    const c = await loadChat();
    expect(ok(c.RoomMessageSchema, message)).toBe(true);
    expect(ok(c.RoomMessageSchema, { ...message, client_msg_id: null })).toBe(true);
    expect(
      ok(c.RoomMessageSchema, {
        ...message,
        run_id: U(5),
        flow_id: U(6),
        trigger_message_id: U(7),
      }),
    ).toBe(true);
    expect(ok(c.RoomMessageSchema, { ...message, sender_type: "agent" })).toBe(true);
    expect(ok(c.RoomMessageSchema, { ...message, sender_type: "system" })).toBe(false);
    expect(ok(c.RoomMessageSchema, { ...message, seq: 0 })).toBe(false);
    expect(
      ok(c.RoomDetailSchema, { ...summaryGroup, owner_id: U(1), created_at: AT, members: [] }),
    ).toBe(false);
    const member = { ...userRef, role: "owner", last_read_seq: 1, joined_at: AT };
    expect(
      ok(c.RoomDetailSchema, {
        ...summaryGroup,
        owner_id: U(1),
        created_at: AT,
        members: [member],
      }),
    ).toBe(true);
  });

  it("HUB-FR-98 · R29 · CreateRoomRequestSchema dm/group; tên trim 1–80; member_ids ≤ 200, mặc định []; tenant_id thừa ⇒ fail [X2a-R08]", async () => {
    const c = await loadChat();
    const s = c.CreateRoomRequestSchema;
    expect(ok(s, { kind: "dm", user_id: U(1) })).toBe(true);
    expect(s.parse({ kind: "group", name: "  Nhóm  " })).toEqual({
      kind: "group",
      name: "Nhóm",
      member_ids: [],
    });
    expect(ok(s, { kind: "group", name: "   " })).toBe(false);
    expect(ok(s, { kind: "group", name: "a".repeat(80) })).toBe(true);
    expect(ok(s, { kind: "group", name: "a".repeat(81) })).toBe(false);
    const ids = (n: number) => Array.from({ length: n }, (_, i) => U(100 + i));
    expect(ok(s, { kind: "group", name: "N", member_ids: ids(200) })).toBe(true);
    expect(ok(s, { kind: "group", name: "N", member_ids: ids(201) })).toBe(false);
    expect(ok(s, { kind: "group", name: "N", tenant_id: U(9) })).toBe(false);
    expect(ok(s, { kind: "dm", user_id: U(1), name: "x" })).toBe(false);
    expect(ok(s, { kind: "channel", name: "x" })).toBe(false);
  });

  it("HUB-FR-96 · R30 · Send/MarkRead/AddMembers/Rename/Transfer: biên [X2a-R15 · R18]", async () => {
    const c = await loadChat();
    const send = c.SendRoomMessageRequestSchema;
    expect(typeof send?.parse).toBe("function");
    expect(send.parse({ content: "  hi ", client_msg_id: U(1) }).content).toBe("hi");
    expect(ok(send, { content: "  ", client_msg_id: U(1) })).toBe(false);
    expect(ok(send, { content: "a".repeat(16_000), client_msg_id: U(1) })).toBe(true);
    expect(ok(send, { content: "a".repeat(16_001), client_msg_id: U(1) })).toBe(false);
    expect(ok(send, { content: "hi" })).toBe(false);
    expect(ok(c.MarkRoomReadRequestSchema, { seq: 0 })).toBe(true);
    expect(ok(c.MarkRoomReadRequestSchema, { seq: -1 })).toBe(false);
    expect(ok(c.MarkRoomReadResponseSchema, { unread: 0, unread_total: 3 })).toBe(true);
    expect(ok(c.AddRoomMembersRequestSchema, { user_ids: [] })).toBe(false);
    expect(ok(c.AddRoomMembersRequestSchema, { user_ids: [U(1)] })).toBe(true);
    expect(ok(c.RenameRoomRequestSchema, { name: "" })).toBe(false);
    expect(ok(c.TransferRoomRequestSchema, { user_id: U(1) })).toBe(true);
  });
});

describe("R31–R33 · me-stream, hằng, snapshot C1 [plan §2.4 · X2a-AC11]", () => {
  const data: Record<string, unknown> = {
    "room.message": { room_id: U(3), message },
    "room.unread": { room_id: U(3), unread: 1, total: 4 },
    "room.read": { room_id: U(3), user_id: U(1), seq: 2 },
    "room.member_added": { room_id: U(3), user_id: U(1), room: summaryGroup },
    "room.member_removed": { room_id: U(3), user_id: U(1) },
    "room.updated": { room_id: U(3), name: "Tên mới" },
    "room.deleted": { room_id: U(3) },
    "stream.reset": {},
  };

  it("HUB-FR-99 · R31 · ME_STREAM_EVENTS 8 sự kiện; parseMeStreamEvent parse đủ 8; JSON hỏng / event lạ / khoá thừa ⇒ null", async () => {
    const c = await loadChat();
    expect([...(c.ME_STREAM_EVENTS ?? [])].sort()).toEqual(Object.keys(data).sort());
    for (const [ev, d] of Object.entries(data)) {
      const got = c.parseMeStreamEvent(ev, JSON.stringify(d));
      expect(got?.event).toBe(ev);
      expect(ok(c.MeStreamEventSchema, { event: ev, data: d })).toBe(true);
    }
    expect(c.parseMeStreamEvent("room.read", "{hỏng")).toBeNull();
    expect(c.parseMeStreamEvent("room.typing", JSON.stringify({ room_id: U(3) }))).toBeNull();
    expect(
      c.parseMeStreamEvent("room.deleted", JSON.stringify({ room_id: U(3), extra: 1 })),
    ).toBeNull();
    expect(
      c.parseMeStreamEvent("room.updated", JSON.stringify({ room_id: U(3), owner_id: U(1) }))
        ?.event,
    ).toBe("room.updated");
  });

  it("HUB-FR-96 · R32 · hằng: STREAM_EVENT_ID_RE, USER_STREAM_MAXLEN=1000, USER_STREAM_CONN_MAX=5, ROOM_MEMBERS_MAX=50, ROOM_NAME_MAX=80, ROOM_PREVIEW_MAX=120", async () => {
    const c = await loadChat();
    expect({
      maxlen: c.USER_STREAM_MAXLEN,
      conn: c.USER_STREAM_CONN_MAX,
      members: c.ROOM_MEMBERS_MAX,
      name: c.ROOM_NAME_MAX,
      preview: c.ROOM_PREVIEW_MAX,
      ids: c.ROOM_IDS_MAX,
    }).toEqual({ maxlen: 1000, conn: 5, members: 50, name: 80, preview: 120, ids: 200 });
    const re = c.STREAM_EVENT_ID_RE as RegExp;
    expect(re.test("1-0")).toBe(true);
    expect(re.test(`${"1".repeat(20)}-${"2".repeat(20)}`)).toBe(true);
    expect(re.test(`${"1".repeat(21)}-0`)).toBe(false);
    expect(re.test("abc")).toBe(false);
  });

  it("HUB-FR-96 · R33 · mọi export C1 của @ai/contracts/chat giữ nguyên tên + hình (snapshot trước B2) [X2a-AC11 · X2a-R23]", async () => {
    const c = await loadChat();
    const snap = JSON.parse(
      readFileSync(join(import.meta.dir, "__fixtures__/chat-exports-c1.json"), "utf8"),
    ) as Record<string, unknown>;
    const names = Object.keys(snap);
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((n) => !(n in c))).toEqual([]);
    expect(await shapes(c, names)).toEqual(snap);
  });
});
