// CR-190 · danh bạ nhóm trang Tin nhắn — luật thuần (không DB): bỏ dấu, con trỏ, thứ tự ghim → mới nhất → chưa nhắn theo tên, người ngoài luật không lọt vào, phân trang.
import { describe, expect, test } from "bun:test";
import {
  type ConvLite,
  chatItems,
  cmpKey,
  type DirPeople,
  decodeDirCursor,
  encodeDirCursor,
  fold,
  internalItems,
  pageAfter,
  unreadSum,
} from "./messages.directory";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const person = (name: string, active = true, job: string | null = null) => ({
  name,
  active,
  job_title: job,
});
const conv = (over: Partial<ConvLite> & { id: string }): ConvLite => ({
  kind: "direct",
  title: null,
  peer_id: null,
  last_seq: 0,
  last_at: "2026-11-01T00:00:00.000Z",
  unread: 0,
  pinned_at: null,
  marked_unread: false,
  ...over,
});

describe("fold", () => {
  test("bỏ dấu tiếng Việt, đ → d, không phân biệt hoa/thường", () => {
    expect(fold("Đặng Thị Ánh")).toBe("dang thi anh");
    expect(fold("BẮC Á")).toBe("bac a");
  });
});

describe("con trỏ", () => {
  test("mã hoá rồi giải mã giữ nguyên, hỏng ⇒ null", () => {
    const k = { k1: 1, k2: "-1763500000.123456", k3: "ha", id: id(1) };
    expect(decodeDirCursor(encodeDirCursor(k))).toEqual(k);
    expect(decodeDirCursor("xxx")).toBeNull();
    expect(
      decodeDirCursor(Buffer.from(JSON.stringify([3, "0", "a", id(1)])).toString("base64url")),
    ).toBeNull();
    expect(
      decodeDirCursor(Buffer.from(JSON.stringify([1, "abc", "a", id(1)])).toString("base64url")),
    ).toBeNull();
  });
  test("so khoá: k1 trước, rồi k2 số, rồi tên, rồi id", () => {
    const a = { k1: 1, k2: "-20", k3: "b", id: id(1) };
    expect(cmpKey(a, { ...a, k2: "-10" })).toBeLessThan(0);
    expect(cmpKey({ ...a, k1: 2 }, { ...a, k2: "-99" })).toBeGreaterThan(0);
    expect(cmpKey(a, { ...a })).toBe(0);
  });
});

describe("internalItems", () => {
  const people: DirPeople = new Map([
    [id(1), person("Hà")],
    [id(2), person("An")],
    [id(3), person("Bình")],
    [id(4), person("Nghỉ", false)],
    [id(5), person("Cũ", false)],
  ]);
  test("ghim → tin mới nhất → chưa từng nhắn theo tên A→Z, người đã nghỉ chỉ khi có lịch sử", () => {
    const convs = [
      conv({ id: id(11), peer_id: id(1), last_seq: 3, last_at: "2026-11-10T00:00:00.000Z" }),
      conv({ id: id(12), peer_id: id(3), last_seq: 3, last_at: "2026-11-12T00:00:00.000Z" }),
      conv({ id: id(13), peer_id: id(2), pinned_at: "2026-11-01T00:00:00.000Z" }),
      conv({ id: id(14), peer_id: id(4), last_seq: 1 }), // nghỉ, có lịch sử ⇒ thấy
      conv({ id: id(15), peer_id: id(5) }), // nghỉ, cuộc rỗng ⇒ không
    ];
    const out = internalItems(convs, people, "").map((i) => i.personId);
    expect(out).toEqual([id(2), id(3), id(1), id(4)]); // An (ghim), Bình (12/11), Hà (10/11), Nghỉ (cũ nhất)
  });
  test("không có cuộc ⇒ chỉ đồng nghiệp còn dùng được, theo tên, người không rõ không lọt vào", () => {
    const out = internalItems([conv({ id: id(11), peer_id: id(99), last_seq: 1 })], people, "");
    expect(out.map((i) => i.personId)).toEqual([id(2), id(3), id(1)]);
    expect(out.every((i) => i.conv === null)).toBe(true);
  });
  test("tìm theo tên hoặc chức vụ, không dấu", () => {
    const p: DirPeople = new Map([
      [id(1), person("Hà", true, "Kế hoạch")],
      [id(2), person("An")],
    ]);
    expect(internalItems([], p, "ke hoach").map((i) => i.personId)).toEqual([id(1)]);
    expect(internalItems([], p, "AN").map((i) => i.personId)).toEqual([id(2)]);
  });
});

describe("chatItems + unreadSum + pageAfter", () => {
  const g = (n: number, over: Partial<ConvLite> = {}) =>
    conv({ id: id(n), kind: "group", title: `Nhóm ${n}`, ...over });
  test("chỉ nhóm, ghim trước, đã nhắn trước chưa nhắn, tìm theo tên nhóm", () => {
    const convs = [
      g(1),
      g(2, { last_seq: 1 }),
      g(3, { pinned_at: "2026-11-01T00:00:00.000Z" }),
      conv({ id: id(9), peer_id: id(1) }),
    ];
    expect(chatItems(convs, "").map((i) => i.conv?.id)).toEqual([id(3), id(2), id(1)]);
    expect(chatItems(convs, "nhom 2").map((i) => i.conv?.id)).toEqual([id(2)]);
  });
  test("chưa đọc = Σ max(thật, cờ), kẹp 999", () => {
    const items = chatItems(
      [
        g(1, { unread: 3 }),
        g(2, { marked_unread: true }),
        g(3, { unread: 2, marked_unread: true }),
      ],
      "",
    );
    expect(unreadSum(items)).toBe(3 + 1 + 2);
    const big = Array.from({ length: 20 }, (_, n) => g(n + 1, { unread: 100 }));
    expect(unreadSum(chatItems(big, ""))).toBe(999);
  });
  test("phân trang: 15 đầu, trang sau không trùng, hết thì `next` null", () => {
    const items = chatItems(
      Array.from({ length: 20 }, (_, n) => g(n + 1)),
      "",
    );
    const p1 = pageAfter(items, null, 15);
    expect(p1.page).toHaveLength(15);
    expect(p1.next).not.toBeNull();
    const p2 = pageAfter(items, p1.next, 15);
    expect(p2.page).toHaveLength(5);
    expect(p2.next).toBeNull();
    expect(new Set([...p1.page, ...p2.page].map((i) => i.rowKey)).size).toBe(20);
  });
});
