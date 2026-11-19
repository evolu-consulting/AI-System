// CR-190 · luật thuần danh bạ nhóm: sắp xếp, áp sự kiện (tin mới / đọc / thu hồi / ghim), «Xem thêm».
import { describe, expect, it } from "bun:test";
import type {
  ConversationSummary,
  Message,
  MsgDirGroup,
  MsgDirRow,
} from "@ai/contracts/pack-contracts";
import { missingBatches } from "./cards";
import {
  appendPage,
  applyDeletedToDir,
  applyNewToDir,
  applyPrefsToDir,
  bodyStatus,
  clearUnreadInDir,
  compareRows,
  type DirData,
  remaining,
} from "./directory";

const ME = "00000000-0000-4000-8000-00000000000a";
const CO = { id: "11111111-1111-4111-8111-111111111111", name: "Công ty A" };
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const conv = (n: number, over: Partial<ConversationSummary> = {}): ConversationSummary =>
  ({
    id: id(n),
    kind: "direct",
    title: null,
    peer: { id: id(500 + n), name: `P${n}`, active: true, job_title: null },
    member_count: 2,
    last_message: {
      seq: 1,
      sender_id: id(500 + n),
      sender_name: `P${n}`,
      preview: `tin ${n}`,
      has_files: false,
      deleted: false,
      at: `2026-11-1${n}T08:00:00.000Z`,
    },
    unread: 0,
    last_at: `2026-11-1${n}T08:00:00.000Z`,
    company: null,
    read_only: false,
    pinned_at: null,
    marked_unread: false,
    ...over,
  }) as ConversationSummary;
const row = (n: number, c: ConversationSummary | null, name = `P${n}`): MsgDirRow => ({
  key: `u:${id(500 + n)}`,
  conversation: c,
  person: { id: id(500 + n), name, job_title: null, active: true, company: CO },
});
const group = (items: MsgDirRow[], over: Partial<MsgDirGroup> = {}): MsgDirGroup => ({
  key: "internal",
  kind: "internal",
  company: null,
  total: items.length,
  unread: items.reduce((s, r) => s + (r.conversation?.unread ?? 0), 0),
  items,
  next_cursor: null,
  ...over,
});
const keys = (d: DirData, g = 0) => d.groups[g]?.items.map((r) => r.key) ?? [];
const msg = (convId: string, from: string, at: string): Message =>
  ({
    id: id(900),
    seq: 2,
    conversation_id: convId,
    sender_id: from,
    client_id: id(901),
    body: "mới",
    files: [],
    at,
    deleted: false,
  }) as Message;
const ctx = { myId: ME, viewing: false, senderName: "P1" };

describe("CR-190 · thứ tự dòng trong nhóm", () => {
  it("ghim → tin mới nhất → chưa từng nhắn theo tên A→Z, ghim vẫn theo tin mới nhất", () => {
    const rows = [
      row(1, null, "Bình"),
      row(2, conv(2)),
      row(3, conv(3, { pinned_at: "2026-11-01T00:00:00.000Z" })),
      row(4, null, "An"),
      row(5, conv(5, { pinned_at: "2026-11-02T00:00:00.000Z" })),
      row(6, null, "Ân"),
    ];
    const names = [...rows].sort(compareRows).map((r) => r.person?.name);
    expect(names).toEqual(["P5", "P3", "P2", "An", "Ân", "Bình"]);
  });
  it("cuộc đã mở nhưng chưa có tin = chưa từng nhắn (xếp theo tên, không giờ)", () => {
    const empty = row(1, conv(1, { last_message: null }), "Zed");
    const sent = row(2, conv(2));
    expect([empty, sent].sort(compareRows)[0]).toBe(sent);
  });
});

describe("CR-190 · tin mới ⇒ dòng nhảy lên đầu nhóm, chỉ nhóm đó đổi", () => {
  const other = group([row(7, conv(7))], { key: "chat", kind: "chat" });
  const d: DirData = {
    groups: [group([row(3, conv(3)), row(2, conv(2)), row(1, null, "An")]), other],
  };
  it("người khác gửi: lên đầu, chưa đọc +1, xem trước mới, tổng nhóm +1", () => {
    const r = applyNewToDir(d, msg(id(2), id(502), "2026-11-19T09:00:00.000Z"), ctx);
    expect(r.known).toBe(true);
    expect(keys(r.data)).toEqual([`u:${id(502)}`, `u:${id(503)}`, `u:${id(501)}`]);
    expect(r.data.groups[0]?.items[0]?.conversation?.unread).toBe(1);
    expect(r.data.groups[0]?.unread).toBe(1);
    expect(r.data.groups[1]).toBe(other);
  });
  it("mình gửi hoặc đang xem: không cộng chưa đọc", () => {
    const mine = applyNewToDir(d, msg(id(2), ME, "2026-11-19T09:00:00.000Z"), ctx);
    expect(mine.data.groups[0]?.unread).toBe(0);
    const viewing = applyNewToDir(d, msg(id(2), id(502), "2026-11-19T09:00:00.000Z"), {
      ...ctx,
      viewing: true,
    });
    expect(viewing.data.groups[0]?.unread).toBe(0);
  });
  it("người chưa từng nhắn (chưa có cuộc) hoặc cuộc lạ ⇒ known=false để tải lại", () => {
    expect(applyNewToDir(d, msg(id(99), id(599), "2026-11-19T09:00:00.000Z"), ctx).known).toBe(
      false,
    );
  });
  it("dòng ghim vẫn ở trên dòng vừa nhắn", () => {
    const pinned = group([
      row(3, conv(3, { pinned_at: "2026-11-01T00:00:00.000Z" })),
      row(2, conv(2)),
    ]);
    const r = applyNewToDir(
      { groups: [pinned] },
      msg(id(2), id(502), "2026-11-19T09:00:00.000Z"),
      ctx,
    );
    expect(keys(r.data)[0]).toBe(`u:${id(503)}`);
  });
});

describe("CR-190 · đọc, thu hồi, ghim, cờ", () => {
  const d: DirData = {
    groups: [group([row(1, conv(1, { unread: 3 })), row(2, conv(2, { unread: 1 }))])],
  };
  it("đã đọc ⇒ chưa đọc cuộc về 0 và tổng nhóm trừ đúng", () => {
    const r = clearUnreadInDir(d, id(1));
    expect(r.groups[0]?.unread).toBe(1);
    expect(clearUnreadInDir(d, id(77))).toEqual(d);
  });
  it("thu hồi tin cuối ⇒ xem trước thành đã thu hồi", () => {
    const r = applyDeletedToDir(d, id(1), 1);
    const c = r.groups[0]?.items.find((x) => x.conversation?.id === id(1))?.conversation;
    expect(c?.last_message?.deleted).toBe(true);
    const same = applyDeletedToDir(d, id(1), 5);
    expect(same.groups[0]?.items.map((x) => x.conversation?.last_message?.deleted)).toEqual([
      false,
      false,
    ]);
  });
  it("ghim ⇒ lên đầu nhóm, bỏ ghim ⇒ về chỗ theo tin", () => {
    const pinned = applyPrefsToDir(d, id(1), {
      pinned_at: "2026-11-19T00:00:00.000Z",
      marked_unread: false,
    });
    expect(keys(pinned)[0]).toBe(`u:${id(501)}`);
    const back = applyPrefsToDir(pinned, id(2), {
      pinned_at: "2026-11-20T00:00:00.000Z",
      marked_unread: false,
    });
    expect(keys(back)[0]).toBe(`u:${id(502)}`);
  });
  it("đánh dấu chưa đọc cuộc đã đọc ⇒ hiện 1 và nhóm +1 (max(thật, cờ))", () => {
    const clean: DirData = { groups: [group([row(1, conv(1))])] };
    const r = applyPrefsToDir(clean, id(1), { pinned_at: null, marked_unread: true });
    expect(r.groups[0]?.items[0]?.conversation?.unread).toBe(1);
    expect(r.groups[0]?.unread).toBe(1);
  });
});

describe("CR-190 · «Xem thêm (n)»", () => {
  const first = group([row(1, null, "An"), row(2, null, "Bình")], { total: 5, next_cursor: "c1" });
  it("n = tổng − số dòng đã tải; hết thì 0", () => {
    expect(remaining(first)).toBe(3);
    expect(remaining({ total: 2, items: first.items })).toBe(0);
  });
  it("nối trang kế vào cuối nhóm, bỏ dòng trùng, đổi con trỏ, nhóm khác giữ nguyên", () => {
    const other = group([], { key: "chat", kind: "chat" });
    const d: DirData = { groups: [first, other] };
    const r = appendPage(d, "internal", {
      items: [row(2, null, "Bình"), row(3, null, "Châu")],
      next_cursor: null,
    });
    expect(keys(r)).toEqual([`u:${id(501)}`, `u:${id(502)}`, `u:${id(503)}`]);
    expect(r.groups[0]?.next_cursor).toBeNull();
    expect(r.groups[1]).toBe(other);
  });
});

describe("CR-148 · thẻ người theo lô", () => {
  const ids = Array.from({ length: 120 }, (_, i) => `u${i}`);
  it("chia lô ≤ 50, bỏ trùng và id đã có", () => {
    const b = missingBatches([...ids, "u1"], (x) => x === "u0");
    expect(b.map((x) => x.length)).toEqual([50, 50, 19]);
    expect(b.flat()).not.toContain("u0");
  });
  it("không thiếu ai ⇒ không gọi", () => {
    expect(missingBatches(ids, () => true)).toEqual([]);
  });
});

describe("CR-190 · trạng thái thân (chống nháy)", () => {
  it("chưa có danh bạ: chờ hoặc lỗi, có danh bạ cũ ⇒ vẫn hiện (làm mờ), lỗi chỉ khi tab Chưa đọc lỗi", () => {
    expect(bodyStatus(false, false, false)).toBe("loading");
    expect(bodyStatus(false, true, false)).toBe("error");
    expect(bodyStatus(true, true, false)).toBe("ready");
    expect(bodyStatus(true, false, true)).toBe("error");
  });
});
