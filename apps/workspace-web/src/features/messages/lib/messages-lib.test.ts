// CR-132 · W2 · luật thuần tin nhắn: sắp xếp/in đậm/lọc, áp sự kiện realtime vào cache, gộp trang tin, quyền hiện nút, chọn người.
import { describe, expect, it } from "bun:test";
import type {
  ConversationDetail,
  ConversationSummary,
  Message,
} from "@ai/contracts/pack-contracts";
import {
  applyDeletedToList,
  applyNewToList,
  bumpTotal,
  clearUnread,
  filterConversations,
  isUnread,
  type ListPages,
  previewOf,
  sortConversations,
  unreadLabel,
} from "./conversations";
import { dayLabel, listTime } from "./format";
import {
  applyDeleted,
  applyNewMessage,
  applyReadToMembers,
  flattenPages,
  groupByDay,
  lastMineSeq,
  type MsgPages,
  nextBefore,
  seenCount,
} from "./message-pages";
import { filterPeople, pickMode } from "./people";
import { canLeave, canManage, canRemoveMember, canRevoke, composerLocked } from "./perms";

const ME = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const conv = (n: number, o: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: id(n),
  kind: "direct",
  title: null,
  peer: { id: B, name: `Người ${n}`, active: true },
  member_count: 2,
  last_message: null,
  unread: 0,
  last_at: `2026-11-0${n}T10:00:00.000Z`,
  ...o,
});
const msg = (seq: number, o: Partial<Message> = {}): Message => ({
  id: id(100 + seq),
  seq,
  conversation_id: id(1),
  sender_id: B,
  client_id: id(200 + seq),
  body: `tin ${seq}`,
  files: [],
  at: "2026-11-05T09:00:00.000Z",
  deleted: false,
  ...o,
});
const list = (...c: ConversationSummary[]): ListPages => ({
  pages: [{ items: c, next_cursor: null }],
  pageParams: [null],
});

describe("danh sách hội thoại", () => {
  it("tin mới nhất lên đầu", () => {
    expect(sortConversations([conv(1), conv(3), conv(2)]).map((c) => c.id)).toEqual([
      id(3),
      id(2),
      id(1),
    ]);
  });
  it("chưa đọc ⇒ in đậm; số 99+ ; 0 ⇒ không hiện", () => {
    expect(isUnread(conv(1, { unread: 2 }))).toBe(true);
    expect(isUnread(conv(1))).toBe(false);
    expect(unreadLabel(0)).toBeNull();
    expect(unreadLabel(7)).toBe("7");
    expect(unreadLabel(99)).toBe("99");
    expect(unreadLabel(100)).toBe("99+"); // server đếm tối đa 100 ⇒ «99+»
    expect(unreadLabel(120)).toBe("99+");
  });
  it("lọc theo tên không phân biệt dấu/hoa thường", () => {
    const items = [
      conv(1, { peer: { id: B, name: "Đặng Thị Hoa", active: true } }),
      conv(2, { kind: "group", title: "Kế toán", peer: null }),
    ];
    expect(filterConversations(items, "dang").map((c) => c.id)).toEqual([id(1)]);
    expect(filterConversations(items, "KE TOAN").map((c) => c.id)).toEqual([id(2)]);
    expect(filterConversations(items, "").length).toBe(2);
  });
  it("xem trước: của mình, người khác (nhóm có tên), tệp, thu hồi", () => {
    const last = (o: object) => ({
      seq: 1,
      sender_id: B,
      sender_name: "Lan",
      preview: "hi",
      has_files: false,
      deleted: false,
      at: "2026-11-05T09:00:00.000Z",
      ...o,
    });
    expect(previewOf({ kind: "group", last_message: last({}) }, ME)).toEqual({
      kind: "other",
      who: "Lan",
      text: "hi",
    });
    expect(previewOf({ kind: "direct", last_message: last({}) }, ME).who).toBe("");
    expect(previewOf({ kind: "direct", last_message: last({ sender_id: ME }) }, ME).kind).toBe(
      "mine",
    );
    expect(
      previewOf({ kind: "direct", last_message: last({ preview: "", has_files: true }) }, ME).kind,
    ).toBe("files");
    expect(previewOf({ kind: "direct", last_message: last({ deleted: true }) }, ME).kind).toBe(
      "deleted",
    );
    expect(previewOf({ kind: "direct", last_message: null }, ME).kind).toBe("none");
  });
  it("msg.new của người khác: lên đầu, +1 chưa đọc, giữ pageParams", () => {
    const r = applyNewToList(list(conv(2), conv(1)), msg(5, { conversation_id: id(1) }), {
      myId: ME,
      viewing: false,
      senderName: "Lan",
    });
    expect(r.known).toBe(true);
    const items = r.data.pages[0]?.items ?? [];
    expect(items.map((c) => c.id)).toEqual([id(1), id(2)]);
    expect(items[0]?.unread).toBe(1);
    expect(items[0]?.last_message?.preview).toBe("tin 5");
    expect(r.data.pageParams).toEqual([null]);
  });
  it("msg.new đang xem hoặc của mình ⇒ không cộng chưa đọc; hội thoại lạ ⇒ known=false", () => {
    const base = list(conv(1));
    const viewing = applyNewToList(base, msg(5), { myId: ME, viewing: true, senderName: "" });
    expect(viewing.data.pages[0]?.items[0]?.unread).toBe(0);
    const mine = applyNewToList(base, msg(6, { sender_id: ME }), {
      myId: ME,
      viewing: false,
      senderName: "",
    });
    expect(mine.data.pages[0]?.items[0]?.unread).toBe(0);
    expect(
      applyNewToList(base, msg(7, { conversation_id: id(9) }), {
        myId: ME,
        viewing: false,
        senderName: "",
      }).known,
    ).toBe(false);
  });
  it("chưa đọc kẹp 100 («99+»); đã đọc ⇒ xoá chấm; thu hồi tin cuối ⇒ xem trước thu hồi", () => {
    const r = applyNewToList(list(conv(1, { unread: 100 })), msg(2), {
      myId: ME,
      viewing: false,
      senderName: "x",
    });
    expect(r.data.pages[0]?.items[0]?.unread).toBe(100);
    expect(clearUnread(list(conv(1, { unread: 4 })), id(1)).pages[0]?.items[0]?.unread).toBe(0);
    const withLast = list(
      conv(1, {
        last_message: {
          seq: 3,
          sender_id: B,
          sender_name: "L",
          preview: "a",
          has_files: false,
          deleted: false,
          at: "2026-11-05T09:00:00.000Z",
        },
      }),
    );
    expect(applyDeletedToList(withLast, id(1), 3).pages[0]?.items[0]?.last_message?.deleted).toBe(
      true,
    );
    expect(applyDeletedToList(withLast, id(1), 2).pages[0]?.items[0]?.last_message?.deleted).toBe(
      false,
    );
  });
  it("tổng chưa đọc kẹp 0..999", () => {
    expect(bumpTotal(998, 5)).toBe(999);
    expect(bumpTotal(0, -1)).toBe(0);
  });
});

describe("trang tin", () => {
  const pages = (): MsgPages => ({
    pages: [
      { items: [msg(4), msg(5)], has_more: true },
      { items: [msg(2), msg(3)], has_more: false },
    ],
    pageParams: [null, 4],
  });
  it("gộp tăng dần theo seq, không trùng", () => {
    expect(flattenPages(pages()).map((m) => m.seq)).toEqual([2, 3, 4, 5]);
    expect(flattenPages(undefined)).toEqual([]);
  });
  it("tải thêm cũ: seq đầu của trang cuối, hết ⇒ undefined", () => {
    expect(nextBefore([{ items: [msg(4), msg(5)], has_more: true }])).toBe(4);
    expect(nextBefore([{ items: [msg(2)], has_more: false }])).toBeUndefined();
  });
  it("msg.new thêm vào trang mới nhất một lần (gửi xong rồi sự kiện tới không nhân đôi)", () => {
    const a = applyNewMessage(pages(), msg(6));
    expect(flattenPages(a).map((m) => m.seq)).toEqual([2, 3, 4, 5, 6]);
    expect(flattenPages(applyNewMessage(a, msg(6))).length).toBe(5);
    expect(a.pageParams).toEqual([null, 4]);
    expect(flattenPages(applyNewMessage(undefined, msg(1))).length).toBe(1);
  });
  it("thu hồi ⇒ rỗng, deleted", () => {
    const m = flattenPages(applyDeleted(pages(), 3)).find((x) => x.seq === 3);
    expect(m).toMatchObject({ deleted: true, body: "", files: [] });
  });
  it("chia theo ngày; nhãn Hôm nay/Hôm qua/ngày; giờ danh sách", () => {
    const g = groupByDay([
      msg(1, { at: "2026-11-04T09:00:00" }),
      msg(2, { at: "2026-11-04T10:00:00" }),
      msg(3, { at: "2026-11-05T09:00:00" }),
    ]);
    expect(g.map((x) => x.items.length)).toEqual([2, 1]);
    const now = new Date("2026-11-05T12:00:00");
    expect(dayLabel("2026-11-05T09:00:00", now).kind).toBe("today");
    expect(dayLabel("2026-11-04T09:00:00", now).kind).toBe("yesterday");
    expect(dayLabel("2026-10-01T09:00:00", now)).toEqual({ kind: "date", text: "01/10/2026" });
    expect(listTime("2026-11-05T09:05:00", now)).toBe("09:05");
    expect(listTime("2026-11-01T09:05:00", now)).toBe("01/11/2026");
  });
  it("«Đã xem»: n người khác đọc tới tin cuối của mình", () => {
    const items = [msg(1), msg(2, { sender_id: ME }), msg(3)];
    expect(lastMineSeq(items, ME)).toBe(2);
    const mem = (uid: string, seq: number) => ({
      user_id: uid,
      name: uid,
      role: "member" as const,
      last_read_seq: seq,
      active: true,
    });
    expect(seenCount(2, [mem(ME, 3), mem(B, 2), mem("c", 1)], ME)).toBe(1);
    expect(seenCount(null, [mem(B, 9)], ME)).toBe(0);
    expect(applyReadToMembers([mem(B, 2)], B, 5)[0]?.last_read_seq).toBe(5);
    expect(applyReadToMembers([mem(B, 5)], B, 2)[0]?.last_read_seq).toBe(5);
  });
});

describe("quyền hiện nút", () => {
  const c = (
    kind: "direct" | "group",
    my_role: "owner" | "member",
  ): Pick<ConversationDetail, "kind" | "my_role" | "peer"> => ({ kind, my_role, peer: null });
  it("chỉ chủ nhóm đổi tên/thêm/bớt; 1-1 cố định; ai cũng rời nhóm", () => {
    expect(canManage(c("group", "owner"))).toBe(true);
    expect(canManage(c("group", "member"))).toBe(false);
    expect(canManage(c("direct", "owner"))).toBe(false);
    expect(canRemoveMember(c("group", "owner"), B, ME)).toBe(true);
    expect(canRemoveMember(c("group", "owner"), ME, ME)).toBe(false);
    expect(canRemoveMember(c("group", "member"), B, ME)).toBe(false);
    expect(canLeave(c("group", "member"))).toBe(true);
    expect(canLeave(c("direct", "member"))).toBe(false);
  });
  it("thu hồi: tin của mình và chưa thu hồi; 1-1 người kia khoá ⇒ khoá ô gửi", () => {
    expect(canRevoke({ sender_id: ME, deleted: false }, ME)).toBe(true);
    expect(canRevoke({ sender_id: B, deleted: false }, ME)).toBe(false);
    expect(canRevoke({ sender_id: ME, deleted: true }, ME)).toBe(false);
    expect(composerLocked({ kind: "direct", peer: { id: B, name: "B", active: false } })).toBe(
      true,
    );
    expect(composerLocked({ kind: "direct", peer: { id: B, name: "B", active: true } })).toBe(
      false,
    );
    expect(composerLocked({ kind: "group", peer: null })).toBe(false);
  });
  it("chọn người: 1 ⇒ nhắn riêng, ≥ 2 ⇒ nhóm, quá 49 ⇒ đầy; lọc bỏ người loại trừ", () => {
    expect([0, 1, 2, 49, 50].map(pickMode)).toEqual(["none", "direct", "group", "group", "full"]);
    const ps = [
      { id: "a", name: "Trần Văn An" },
      { id: "b", name: "Lê Bình" },
    ];
    expect(filterPeople(ps, "an").map((p) => p.id)).toEqual(["a"]);
    expect(filterPeople(ps, "", ["a"]).map((p) => p.id)).toEqual(["b"]);
  });
});
