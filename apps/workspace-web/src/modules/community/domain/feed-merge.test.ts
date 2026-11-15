// [CR-147] Gộp trang đầu bảng tin: đổi người xem/bộ lọc ⇒ bỏ danh sách cũ (không giữ bài người xem mới không được thấy).
import { describe, expect, test } from "bun:test";
import type { FeedResponse } from "@ai/contracts/community";
import { applyFirstPage, feedScopeKey, mergeFirstPage, withoutGone } from "./feed-merge";

const post = (id: string) => ({ id }) as unknown as FeedResponse["items"][number];
const page = (ids: string[], next?: string): FeedResponse =>
  ({
    items: ids.map(post),
    counts: { all: ids.length },
    facets: { cats: [], areas: [] },
    ...(next ? { nextCursor: next } : {}),
  }) as unknown as FeedResponse;

describe("feedScopeKey", () => {
  const q = { tab: "all" } as never;
  test("đổi người xem hoặc vai ⇒ khoá đổi; cùng người cùng bộ lọc ⇒ khoá giữ", () => {
    const a = { userId: "u1", orgId: "o1", role: "host_member" } as never;
    expect(feedScopeKey(q, a)).toBe(feedScopeKey(q, { ...(a as object) } as never));
    expect(feedScopeKey(q, a)).not.toBe(
      feedScopeKey(q, { userId: "u2", orgId: "o1", role: "partner" } as never),
    );
    expect(feedScopeKey(q, a)).not.toBe(feedScopeKey({ tab: "sell" } as never, a));
  });
});

describe("applyFirstPage", () => {
  const old = page(["a", "b", "c", "x-old-1", "x-old-2"], "cur2");
  test("cùng phạm vi ⇒ gộp: giữ bài đã tải dần ở trang sau", () => {
    const r = applyFirstPage(old, page(["a", "b", "c"], "cur1"), true);
    expect(r.items.map((p) => p.id)).toEqual(["a", "b", "c", "x-old-1", "x-old-2"]);
    expect(r.nextCursor).toBe("cur2");
  });
  test("đổi người xem/bộ lọc ⇒ thay hẳn bằng trang đầu mới, không còn bài cũ", () => {
    const r = applyFirstPage(old, page(["z"], "cur9"), false);
    expect(r.items.map((p) => p.id)).toEqual(["z"]);
    expect(r.nextCursor).toBe("cur9");
  });
  test("chưa có dữ liệu cũ ⇒ lấy trang mới", () => {
    expect(applyFirstPage(null, page(["q"]), true).items).toHaveLength(1);
  });
});

describe("mergeFirstPage", () => {
  test("bài trang đầu lấy bản mới; hết bài ở trang sau ⇒ dùng nextCursor của trang mới", () => {
    const r = mergeFirstPage(page(["a", "b"], "c0"), page(["a", "b"]));
    expect(r.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(r.nextCursor).toBeUndefined();
  });
});

describe("withoutGone", () => {
  test("xoá bài ở trang sau: nạp lại trang đầu vẫn giữ bài cũ trong đuôi, nhưng bài đã xoá bị bỏ ngay", () => {
    const old = page(["a", "b", "c", "d"], "cur");
    const merged = mergeFirstPage(old, page(["a", "b"], "cur"));
    expect(merged.items.map((p) => p.id)).toContain("d"); // ghost nếu không lọc
    const r = withoutGone(merged, new Set(["d"]));
    expect(r?.items.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  test("không có bài xoá ⇒ trả nguyên đối tượng; null ⇒ null", () => {
    const d = page(["a"]);
    expect(withoutGone(d, new Set(["zz"]))).toBe(d);
    expect(withoutGone(null, new Set(["a"]))).toBeNull();
  });
});
