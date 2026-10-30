// fix-migrate-guard · luật thuần: lệch journal ↔ bảng theo dõi; mọi thư mục migration có `when` tăng ngặt, không trùng.
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ACCEPTED_EDITS, journalDrift, readJournal } from "./migrate-guard";

const T = "__drizzle_migrations_x";
const j = [
  { tag: "0001_a", when: 100, hash: "a" },
  { tag: "0002_b", when: 200, hash: "b" },
  { tag: "0003_c", when: 300, hash: "c" },
];

describe("fix-migrate-guard · journalDrift", () => {
  test("khớp (một phần hoặc đủ) ⇒ không lỗi; DB rỗng ⇒ không lỗi", () => {
    expect(journalDrift(T, j, [])).toEqual([]);
    expect(journalDrift(T, j, [{ hash: "a", created_at: 100 }])).toEqual([]);
    expect(
      journalDrift(
        T,
        j,
        j.map((e) => ({ hash: e.hash, created_at: e.when })),
      ),
    ).toEqual([]);
  });

  test("sự cố prod: dòng lạ cùng `when` với entry chưa áp ⇒ 2 lỗi (dòng lạ + entry bị bỏ qua im lặng)", () => {
    const rows = [
      { hash: "a", created_at: 100 },
      { hash: "z", created_at: 200 },
    ];
    const errs = journalDrift(T, j, rows);
    expect(errs).toHaveLength(2);
    expect(errs[0]).toContain("created_at=200 hash=z");
    expect(errs[1]).toContain("journal 0002_b (when=200)");
  });

  test("entry chèn vào giữa (when ≤ mốc cuối) chưa áp ⇒ lỗi", () => {
    const rows = [
      { hash: "a", created_at: 100 },
      { hash: "c", created_at: 300 },
    ];
    expect(journalDrift(T, j, rows)).toEqual([
      "journal 0002_b (when=200) ≤ mốc cuối DB 300 nhưng chưa áp — Drizzle sẽ bỏ qua im lặng",
    ]);
  });

  test("ACCEPTED_EDITS: hash cũ của file đã sửa được chấp nhận, chỉ đúng bảng + tag có trong journal", () => {
    const acc = [{ table: T, tag: "0002_b", dbHash: "b-old", why: "test" }];
    const rows = [
      { hash: "a", created_at: 100 },
      { hash: "b-old", created_at: 200 },
    ];
    expect(journalDrift(T, j, rows, acc)).toEqual([]);
    expect(journalDrift("__khac", j, rows, acc)).toHaveLength(2);
  });
});

const DB_DIR = fileURLToPath(new URL("..", import.meta.url));
const folders = readdirSync(DB_DIR).filter((d) => d.startsWith("migrations"));

describe("fix-migrate-guard · journal mọi thư mục migration", () => {
  test.each(folders)("%s: `when` tăng ngặt, không trùng; tag không trùng", (f) => {
    const e = readJournal(`${DB_DIR}${f}`);
    expect(e.length).toBeGreaterThan(0);
    const bad = e.filter((x, i) => i > 0 && x.when <= (e[i - 1]?.when ?? 0)).map((x) => x.tag);
    expect(bad).toEqual([]);
    expect(new Set(e.map((x) => x.tag)).size).toBe(e.length);
  });

  test("ACCEPTED_EDITS trỏ tới tag có thật trong journal hub", () => {
    const tags = new Set(readJournal(`${DB_DIR}migrations-hub`).map((x) => x.tag));
    for (const a of ACCEPTED_EDITS) expect(tags.has(a.tag)).toBe(true);
  });
});
