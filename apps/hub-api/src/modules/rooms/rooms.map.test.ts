// HUB-FR-96 · HUB-FR-97 · map hàng DB → contract: kết quả phải qua đúng schema `@ai/contracts/chat` (strict).
import { describe, expect, test } from "bun:test";
import {
  RoomActiveRunSchema,
  RoomDetailSchema,
  RoomMessageSchema,
  RoomSummarySchema,
} from "@ai/contracts/chat";
import {
  type RoomMemberRow,
  type RoomSummaryRow,
  toActiveRun,
  toRoomDetail,
  toRoomMessage,
  toRoomSummary,
} from "./rooms.map";

const A = "a2a00000-0000-4000-8000-00000000000a";
const B = "a2a00000-0000-4000-8000-00000000000b";
const R = "a2a00000-0000-4000-8000-000000000f01";
const at = new Date("2026-10-07T01:00:00.000Z");
const ref = (id: string, name: string | null) => ({ id, displayName: name, username: name });

const group: RoomSummaryRow = {
  id: R,
  kind: "group",
  name: "Nhóm",
  peer: null,
  memberCount: 2,
  myRole: "member",
  lastSeq: 5,
  lastReadSeq: 2,
  lastActivityAt: at,
  last: { seq: 5, senderType: "user", sender: ref(A, "lan"), content: "  a \n b ", createdAt: at },
};
const members: RoomMemberRow[] = [
  { user: ref(A, "lan"), role: "owner", lastReadSeq: 5, joinedAt: at },
  { user: ref(B, "hoa"), role: "member", lastReadSeq: 2, joinedAt: at },
];

describe("rooms.map", () => {
  test("nhóm: unread = last − read, preview gộp khoảng trắng, peer null", () => {
    const s = RoomSummarySchema.parse(toRoomSummary(group));
    expect(s).toMatchObject({ unread: 3, peer: null, my_role: "member", name: "Nhóm" });
    expect(s.last_message?.preview).toBe("a b");
  });

  test("DM: name/my_role null, peer có; tên thiếu ⇒ fallback id", () => {
    const dm = { ...group, kind: "dm" as const, name: null, peer: ref(B, null), last: null };
    const s = RoomSummarySchema.parse(toRoomSummary(dm));
    expect(s).toMatchObject({ name: null, my_role: null, last_message: null });
    expect(s.peer).toEqual({ id: B, display_name: B, username: B });
  });

  test("detail: owner_id suy từ role (D2); DM ⇒ null", () => {
    expect(RoomDetailSchema.parse(toRoomDetail(group, members, at)).owner_id).toBe(A);
    const dm = toRoomDetail({ ...group, kind: "dm", name: null, peer: ref(B, "hoa") }, members, at);
    expect(dm.owner_id).toBeNull();
  });

  test("tin nhắn khớp RoomMessageSchema, không gửi trường X2b", () => {
    const m = toRoomMessage({
      id: B,
      roomId: R,
      seq: 1,
      senderType: "user",
      sender: ref(A, "lan"),
      content: "x",
      clientMsgId: null,
      createdAt: at,
    });
    expect(RoomMessageSchema.parse(m)).toEqual(m);
    expect("run_id" in m).toBe(false);
  });
});

describe("rooms.map · X2b", () => {
  test("X2b-R10 · active_runs: Orchestrator ⇒ agent null; wait_kind chỉ khi có", () => {
    const run = { runId: R, flowId: R, triggerMessageId: R, caller: ref(A, null), startedAt: at };
    const a = RoomActiveRunSchema.parse(
      toActiveRun({ ...run, agent: null, status: "waiting", waitKind: "need_input" }),
    );
    expect(a).toMatchObject({ agent: null, status: "waiting", wait_kind: "need_input" });
    expect(a.caller.display_name).toBe(A);
    const b = toActiveRun({
      ...run,
      agent: { key: "hoadon", name: { vi: "HĐ", en: "Inv" } },
      status: "running",
    });
    expect(RoomActiveRunSchema.parse(b)).toEqual(b);
    expect("wait_kind" in b).toBe(false);
  });

  test("X2b · flow{message_count,last_active_at} trên tin gốc", () => {
    const m = toRoomMessage({
      id: R,
      roomId: R,
      seq: 2,
      senderType: "user",
      sender: ref(A, "lan"),
      content: "x",
      clientMsgId: null,
      createdAt: at,
      flowId: R,
      placement: "main",
      flow: { messageCount: 3, lastActiveAt: at },
    });
    expect(RoomMessageSchema.parse(m).flow).toEqual({
      message_count: 3,
      last_active_at: at.toISOString(),
    });
  });
});
