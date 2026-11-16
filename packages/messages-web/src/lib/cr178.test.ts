// CR-178 · M1 · luật thuần giao diện Tin nhắn mới: tab danh sách, gộp tin, vạch chưa đọc, «n tin mới», «Đã xem», «⋯», «Nhắn tin mới».
import { describe, expect, it } from "bun:test";
import type { ConversationMember, Message, MsgPerson } from "@ai/contracts/pack-contracts";
import {
  groupRows,
  groupTime,
  messageActions,
  newBelowCount,
  seenPeople,
  unreadDividerSeq,
} from "./chat-view";
import { ALL_VIEW, pickTab, viewFilter, viewFromParam, viewUnread } from "./list-view";
import { groupByDept, needsGroupName, planNewChat, toggleSelection } from "./new-chat";
import type { Row } from "./rows";

const ME = "00000000-0000-4000-8000-00000000000a";
const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const CO = "11111111-1111-4111-8111-111111111111";

const msg = (seq: number, from: string, at: string, over: Partial<Message> = {}): Message =>
  ({
    seq,
    sender_id: from,
    at,
    body: `t${seq}`,
    deleted: false,
    client_id: `c${seq}`,
    conversation_id: "x",
    files: [],
    ...over,
  }) as Message;
const sent = (m: Message): Row => ({ kind: "sent", key: m.client_id, m });
const pending = (id: string): Row => ({
  kind: "pending",
  key: id,
  p: { clientId: id, body: "x", fileNames: [], failed: null },
});
const mem = (id: string, read: number): ConversationMember =>
  ({
    user_id: id,
    name: id,
    role: "member",
    last_read_seq: read,
    active: true,
  }) as ConversationMember;

describe("CR-178 · tab danh sách", () => {
  it("Tất cả/Chưa đọc không lọc công ty; Chưa đọc gọi unread", () => {
    expect(viewFilter(ALL_VIEW)).toBe("all");
    expect(viewUnread({ tab: "unread", company: null })).toBe(true);
    expect(viewUnread(ALL_VIEW)).toBe(false);
  });
  it("Đối tác chọn công ty ⇒ lọc công ty đó; chưa chọn ⇒ giữ nguyên view", () => {
    expect(viewFilter({ tab: "partner", company: CO })).toBe(CO);
    expect(pickTab(ALL_VIEW, "partner")).toEqual(ALL_VIEW);
    expect(pickTab({ tab: "all", company: CO }, "partner")).toEqual({
      tab: "partner",
      company: CO,
    });
  });
  it("?company= đối tác ⇒ tab Đối tác; own/rỗng/công ty mình ⇒ Tất cả", () => {
    expect(viewFromParam(CO, "x")).toEqual({ tab: "partner", company: CO });
    expect(viewFromParam("own", CO)).toEqual(ALL_VIEW);
    expect(viewFromParam(undefined, CO)).toEqual(ALL_VIEW);
    expect(viewFromParam(CO, CO)).toEqual(ALL_VIEW);
  });
});

describe("CR-178 · gộp tin liên tiếp cùng người", () => {
  it("cùng người trong 5 phút ⇒ một nhóm, giờ lấy ở tin cuối", () => {
    const a = msg(1, U1, "2026-11-01T08:00:00Z");
    const b = msg(2, U1, "2026-11-01T08:02:00Z");
    const g = groupRows([sent(a), sent(b)], ME);
    expect(g).toHaveLength(1);
    expect(g[0]?.rows).toHaveLength(2);
    expect(groupTime(g[0] as (typeof g)[number])).toBe(b.at);
  });
  it("đổi người hoặc cách > 5 phút ⇒ tách nhóm", () => {
    const rows = [
      sent(msg(1, U1, "2026-11-01T08:00:00Z")),
      sent(msg(2, U2, "2026-11-01T08:01:00Z")),
      sent(msg(3, U2, "2026-11-01T08:30:00Z")),
    ];
    expect(groupRows(rows, ME).map((x) => x.rows.length)).toEqual([1, 1, 1]);
  });
  it("vạch chưa đọc luôn mở nhóm mới dù cùng người", () => {
    const rows = [
      sent(msg(1, U1, "2026-11-01T08:00:00Z")),
      sent(msg(2, U1, "2026-11-01T08:01:00Z")),
    ];
    expect(groupRows(rows, ME, 2).map((x) => x.rows.length)).toEqual([1, 1]);
  });
  it("tin đang gửi nối vào nhóm của mình, không có giờ", () => {
    const g = groupRows([sent(msg(1, ME, "2026-11-01T08:00:00Z")), pending("p1")], ME);
    expect(g).toHaveLength(1);
    expect(g[0]?.mine).toBe(true);
    expect(groupTime(g[0] as (typeof g)[number])).toBeNull();
  });
});

describe("CR-178 · vạch «Tin chưa đọc» và «n tin mới»", () => {
  const items = [msg(1, U1, "t"), msg(2, ME, "t"), msg(3, U1, "t"), msg(4, U1, "t")];
  it("vạch ở tin đầu của người khác sau mốc đọc lúc mở", () => {
    expect(unreadDividerSeq(items, 2, ME)).toBe(3);
    expect(unreadDividerSeq(items, 0, ME)).toBe(1);
  });
  it("đã đọc hết hoặc chưa biết mốc ⇒ không có vạch", () => {
    expect(unreadDividerSeq(items, 4, ME)).toBeNull();
    expect(unreadDividerSeq(items, null, ME)).toBeNull();
    expect(unreadDividerSeq([msg(5, ME, "t")], 4, ME)).toBeNull();
  });
  it("đếm tin mới của người khác sau mốc đã thấy (bỏ tin mình, tin thu hồi)", () => {
    expect(newBelowCount(items, 1, ME)).toBe(2);
    expect(newBelowCount([...items, msg(5, U1, "t", { deleted: true })], 1, ME)).toBe(2);
    expect(newBelowCount(items, 4, ME)).toBe(0);
  });
});

describe("CR-178 · «Đã xem» bằng avatar", () => {
  it("chỉ người khác đã đọc tới tin cuối của mình", () => {
    const m = [mem(ME, 9), mem(U1, 5), mem(U2, 3)];
    expect(seenPeople(5, m, ME).map((x) => x.user_id)).toEqual([U1]);
    expect(seenPeople(null, m, ME)).toEqual([]);
  });
});

describe("CR-178 · «⋯» trên tin: quyền hiện Sao chép / Thu hồi", () => {
  it("tin của mình: Sao chép + Thu hồi; tin người khác: chỉ Sao chép", () => {
    expect(messageActions(msg(1, ME, "t"), ME)).toEqual(["copy", "revoke"]);
    expect(messageActions(msg(1, U1, "t"), ME)).toEqual(["copy"]);
  });
  it("tin đã thu hồi ⇒ không thao tác; tin chỉ có tệp ⇒ không Sao chép", () => {
    expect(messageActions(msg(1, ME, "t", { deleted: true }), ME)).toEqual([]);
    expect(messageActions(msg(1, ME, "t", { body: "" }), ME)).toEqual(["revoke"]);
  });
});

const person = (id: string, dept: string | null): MsgPerson =>
  ({
    id,
    name: id,
    department: dept ? { id: `d-${dept}`, name: dept } : null,
    job_title: null,
    company: { id: CO, name: "Đối tác A" },
  }) as MsgPerson;

describe("CR-178 · hộp «Nhắn tin mới»", () => {
  it("Công ty mình: chọn nhiều, bấm lại thì bỏ, tối đa 49 người", () => {
    expect(toggleSelection([], U1, "own")).toEqual([U1]);
    expect(toggleSelection([U1], U2, "own")).toEqual([U1, U2]);
    expect(toggleSelection([U1, U2], U1, "own")).toEqual([U2]);
    const full = Array.from({ length: 49 }, (_, i) => `u${i}`);
    expect(toggleSelection(full, "extra", "own")).toHaveLength(49);
  });
  it("Đối tác: chỉ một người, chọn người khác thì thay", () => {
    expect(toggleSelection([U1], U2, "partner")).toEqual([U2]);
    expect(toggleSelection([U1], U1, "partner")).toEqual([]);
  });
  it("«Tên nhóm» bắt buộc khi ≥ 2 người nội bộ", () => {
    expect(needsGroupName("own", 2)).toBe(true);
    expect(needsGroupName("own", 1)).toBe(false);
    expect(needsGroupName("partner", 1)).toBe(false);
    expect(planNewChat("own", [U1, U2], "  ", null)).toEqual({ ok: false, reason: "name" });
  });
  it("kế hoạch tạo: 1 người ⇒ direct, ≥ 2 ⇒ group, đối tác ⇒ partner, chưa chọn ⇒ none", () => {
    expect(planNewChat("own", [U1], "", null)).toEqual({
      ok: true,
      body: { kind: "direct", user_id: U1 },
    });
    expect(planNewChat("own", [U1, U2], " Nhóm ", null)).toEqual({
      ok: true,
      body: { kind: "group", title: "Nhóm", member_ids: [U1, U2] },
    });
    expect(planNewChat("partner", [U1], "", person(U1, null))).toEqual({
      ok: true,
      body: { kind: "partner", tenant_id: CO, user_id: U1 },
    });
    expect(planNewChat("own", [], "", null)).toEqual({ ok: false, reason: "none" });
  });
  it("gom theo phòng ban: A→Z, «Chưa có phòng» cuối", () => {
    const g = groupByDept([person("a", null), person("b", "Mua"), person("c", "Bán")]);
    expect(g.map((x) => x.name)).toEqual(["Bán", "Mua", null]);
  });
});
