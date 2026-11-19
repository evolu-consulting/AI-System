// CR-136 · ghép tin tạm/thật theo client_id (không nháy), trạng thái lỗi giữ tin.
import { describe, expect, it } from "bun:test";
import type { Message, MsgDirRow } from "@ai/contracts/pack-contracts";
import { canAct, convToRow, dirRowView, markIsRead } from "./dir-rows";
import { mergeRows, type PendingMsg, stateOf } from "./rows";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (seq: number, at = "2026-11-12T09:00:00", clientN = seq): Message => ({
  id: id(100 + seq),
  seq,
  conversation_id: id(1),
  sender_id: id(2),
  client_id: id(200 + clientN),
  body: `t${seq}`,
  files: [],
  at,
  deleted: false,
});
const pend = (n: number, failed: string | null = null): PendingMsg => ({
  clientId: id(200 + n),
  body: `p${n}`,
  fileNames: [],
  failed,
});

describe("mergeRows", () => {
  it("tin đang gửi nằm cuối, CÙNG nhóm ngày hôm nay với tin thật (không đổi cha khi được thay)", () => {
    const g = mergeRows([msg(1, "2026-11-11T09:00:00"), msg(2)], [pend(9)], "2026-11-12");
    expect(g.map((x) => [x.day, x.rows.length])).toEqual([
      ["2026-11-11", 1],
      ["2026-11-12", 2],
    ]);
    expect(g[1]?.rows[1]?.kind).toBe("pending");
  });
  it("khoá tin tạm = client_id; khi server xác nhận khoá tin thật y hệt ⇒ phần tử được giữ", () => {
    const before = mergeRows([msg(1)], [pend(9)], "2026-11-12");
    const after = mergeRows([msg(1), msg(2, "2026-11-12T10:00:00", 9)], [], "2026-11-12");
    const k = (g: ReturnType<typeof mergeRows>) => g.flatMap((x) => x.rows.map((r) => r.key));
    expect(k(before)[1]).toBe(k(after)[1]);
    expect(after[0]?.rows[1]?.kind).toBe("sent");
  });
  it("tin tạm đã có bản thật (msg.new tới trước kết quả POST) ⇒ không hiện hai lần", () => {
    const g = mergeRows([msg(1, "2026-11-12T09:00:00", 9)], [pend(9)], "2026-11-12");
    expect(g.flatMap((x) => x.rows).length).toBe(1);
    expect(g[0]?.rows[0]?.kind).toBe("sent");
  });
  it("không có tin thật hôm nay ⇒ tạo nhóm hôm nay cho tin đang gửi", () => {
    const g = mergeRows([msg(1, "2026-11-10T09:00:00")], [pend(9)], "2026-11-12");
    expect(g.map((x) => x.day)).toEqual(["2026-11-10", "2026-11-12"]);
  });
});

describe("stateOf", () => {
  it("sent / sending / failed (lỗi giữ nguyên tin để gửi lại)", () => {
    const [g] = mergeRows(
      [msg(1)],
      [pend(8), pend(9, "contracts.messages.err.load")],
      "2026-11-12",
    );
    expect(g?.rows.map(stateOf)).toEqual(["sent", "sending", "failed"]);
  });
});

// CR-190 · dòng danh bạ: dữ liệu hiển thị của một dòng (người chưa nhắn, đã nhắn, ghim, nhóm chat).
describe("CR-190 · dirRowView", () => {
  const CO = { id: id(7), name: "Công ty A" };
  const person = (over: Record<string, unknown> = {}) => ({
    id: id(2),
    name: "An",
    job_title: "Kế toán",
    active: true,
    company: CO,
    ...over,
  });
  const conv = (over: Record<string, unknown> = {}) =>
    ({
      id: id(3),
      kind: "partner",
      title: null,
      peer: { id: id(2), name: "An", active: true, job_title: "Kế toán" },
      company: CO,
      last_message: {
        seq: 1,
        sender_id: id(2),
        sender_name: "An",
        preview: "chào",
        has_files: false,
        deleted: false,
        at: "2026-11-12T09:00:00.000Z",
      },
      unread: 120,
      last_at: "2026-11-12T09:00:00.000Z",
      read_only: false,
      pinned_at: "2026-11-12T10:00:00.000Z",
      ...over,
    }) as unknown as NonNullable<MsgDirRow["conversation"]>;
  it("người chưa từng nhắn: không giờ, không chưa đọc, không «⋯»", () => {
    const r: MsgDirRow = { key: "u:1", conversation: null, person: person() };
    const v = dirRowView(r, false);
    expect([v.hasMessage, v.at, v.unread, v.unreadText, v.pinned]).toEqual([
      false,
      null,
      0,
      null,
      false,
    ]);
    expect(v.sub).toBe("Kế toán");
    expect(canAct(r)).toBe(false);
  });
  it("đã nhắn: giờ, ghim, chưa đọc kẹp «99+», công ty chỉ hiện khi được yêu cầu", () => {
    const r: MsgDirRow = { key: "u:1", conversation: conv(), person: person() };
    const v = dirRowView(r, true);
    expect([v.hasMessage, v.pinned, v.unreadText]).toEqual([true, true, "99+"]);
    expect(v.sub).toBe("Kế toán · Công ty A");
    expect(dirRowView(r, false).sub).toBe("Kế toán");
    expect(canAct(r)).toBe(true);
  });
  it("nhóm chat không có người ⇒ là nhóm; cuộc 1-1 phẳng (tab Chưa đọc) vẫn là người", () => {
    const g = dirRowView(
      {
        key: "c:1",
        conversation: conv({ kind: "group", title: "Kinh doanh", peer: null }),
        person: null,
      },
      false,
    );
    expect([g.isGroup, g.title, g.personId]).toEqual([true, "Kinh doanh", null]);
    const d = dirRowView(convToRow(conv()), true);
    expect([d.isGroup, d.personId, d.title]).toEqual([false, id(2), "An"]);
  });
  it("người nghỉ hoặc cuộc chỉ đọc ⇒ readOnly", () => {
    expect(
      dirRowView({ key: "u:1", conversation: null, person: person({ active: false }) }, false)
        .readOnly,
    ).toBe(true);
    expect(
      dirRowView({ key: "u:1", conversation: conv({ read_only: true }), person: person() }, false)
        .readOnly,
    ).toBe(true);
  });
  it("nút đánh dấu: đang chưa đọc (kể cả cờ) ⇒ «đã đọc», ngược lại «chưa đọc»", () => {
    expect(markIsRead({ unread: 1 })).toBe(true);
    expect(markIsRead({ unread: 0 })).toBe(false);
  });
});
