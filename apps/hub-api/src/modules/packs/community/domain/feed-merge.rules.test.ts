import { describe, expect, it } from "bun:test";
import { mergeNewest, microOf, newer } from "./feed-merge.rules";

const r = (t: string, id: string) => ({ created_at: t, id });

describe("CR-191 trộn bảng tin gộp", () => {
  it("micro giây: hai bài cùng mili giây vẫn đúng thứ tự; định dạng Postgres và ISO Z cùng thang", () => {
    expect(microOf("2026-11-19T10:00:00.123457+00:00")).toBe(
      microOf("2026-11-19T10:00:00.123457Z"),
    );
    expect(
      newer(r("2026-11-19T10:00:00.123457Z", "a"), r("2026-11-19T10:00:00.123456+00:00", "b")),
    ).toBe(true);
    expect(newer(r("2026-11-19T17:00:00+07:00", "b"), r("2026-11-19T10:00:00Z", "a"))).toBe(true); // bằng nhau ⇒ id
    expect(newer(r("2026-11-19T10:00:00Z", "0a"), r("2026-11-19T10:00:00Z", "0b"))).toBe(false);
  });

  it("trộn hai nguồn mới nhất trước, lấy đúng limit, báo còn trang sau", () => {
    const own = [r("2026-11-19T10:00:05Z", "o1"), r("2026-11-19T10:00:02Z", "o2")];
    const con = [r("2026-11-19T10:00:04Z", "c1"), r("2026-11-19T10:00:01Z", "c2")];
    const m = mergeNewest(own, con, 3);
    expect(m.items.map((x) => `${x.src}:${x.row.id}`)).toEqual([
      "own:o1",
      "connected:c1",
      "own:o2",
    ]);
    expect(m.more).toBe(true);
    const all = mergeNewest(own, con, 20);
    expect(all.items).toHaveLength(4);
    expect(all.more).toBe(false);
  });

  it("một nguồn rỗng ⇒ nguồn kia nguyên vẹn; cả hai rỗng ⇒ rỗng", () => {
    expect(mergeNewest([], [r("2026-11-19T10:00:00Z", "c")], 20).items[0]?.src).toBe("connected");
    expect(mergeNewest([], [], 20)).toEqual({ items: [], more: false });
  });
});
