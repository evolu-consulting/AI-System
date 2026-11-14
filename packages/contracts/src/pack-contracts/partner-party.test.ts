// CR-151e · luật thuần danh sách Đối tác: gộp vai, lọc, tìm không dấu, sắp xếp theo điểm, cắt trang + next_offset, trần limit.
import { describe, expect, test } from "bun:test";
import {
  filterParties,
  PARTY_PAGE_MAX,
  PartyPageQuerySchema,
  pageParties,
  partiesOf,
  type ScoreRow,
  sortParties,
} from "./partner-party";

const row = (name: string, role: ScoreRow["role"], o: Partial<ScoreRow> = {}): ScoreRow => ({
  party: `name:${name.toLowerCase()}`,
  name,
  role,
  score: 85,
  band: "good",
  reason: "",
  event_count: 5,
  adjust: 0,
  contracts: 0,
  ...o,
});
const rows: ScoreRow[] = [
  row("Đại Phát", "customer", { score: 90 }),
  row("Đại Phát", "supplier", { score: 60, band: "watch" }),
  row("An Bình", "supplier", { score: 75, band: "fair" }),
  row("Cát Tường", "customer", { score: null, band: null }),
  row("Bắc Hà", "customer", { red_flag: true, red_flags: [{ type: "fraud", n: 1 }] }),
];
const all = partiesOf(rows);

describe("partiesOf — một dòng mỗi đối tác", () => {
  test("hai vai gộp một dòng, cờ đỏ trước rồi tên", () => {
    expect(all.map((p) => p.name)).toEqual(["Bắc Hà", "An Bình", "Cát Tường", "Đại Phát"]);
    expect(all.find((p) => p.name === "Đại Phát")?.roles.map((r) => r.role)).toEqual([
      "supplier",
      "customer",
    ]);
  });
});

describe("filterParties", () => {
  test("vai, CHÚ Ý (mức xấu nhất = watch), cờ đỏ", () => {
    expect(filterParties(all, "supplier", undefined).map((p) => p.name)).toEqual([
      "An Bình",
      "Đại Phát",
    ]);
    expect(filterParties(all, "watch", undefined).map((p) => p.name)).toEqual(["Đại Phát"]);
    expect(filterParties(all, "flag", undefined).map((p) => p.name)).toEqual(["Bắc Hà"]);
  });
  test("tìm không dấu, không phân biệt hoa thường, mọi từ phải khớp", () => {
    expect(filterParties(all, "all", "dai").map((p) => p.name)).toEqual(["Đại Phát"]);
    expect(filterParties(all, "all", "CAT tuong").map((p) => p.name)).toEqual(["Cát Tường"]);
    expect(filterParties(all, "all", "dai binh")).toEqual([]);
    expect(filterParties(all, "all", "   ")).toHaveLength(4);
  });
});

describe("sortParties", () => {
  test("điểm thấp nhất các vai tăng hoặc giảm, chưa có điểm luôn cuối", () => {
    expect(sortParties(all, "score_asc").map((p) => p.name)).toEqual([
      "Đại Phát", // min(90,60)=60
      "An Bình",
      "Bắc Hà",
      "Cát Tường",
    ]);
    expect(sortParties(all, "score_desc").map((p) => p.name)).toEqual([
      "Bắc Hà",
      "An Bình",
      "Đại Phát",
      "Cát Tường",
    ]);
  });
  test("theo tên, mặc định attention = cờ đỏ trước", () => {
    expect(sortParties(all, "name").map((p) => p.name)).toEqual([
      "An Bình",
      "Bắc Hà",
      "Cát Tường",
      "Đại Phát",
    ]);
    expect(sortParties(all, "attention")[0]?.name).toBe("Bắc Hà");
  });
});

describe("pageParties", () => {
  test("trang 2, total, next_offset, trang cuối null, quá cuối rỗng", () => {
    expect(pageParties(all, 3, 3)).toMatchObject({ total: 4, next_offset: null });
    expect(pageParties(all, 3, 3).items).toHaveLength(1);
    expect(pageParties(all, 2, 0).next_offset).toBe(2);
    expect(pageParties(all, 2, 2)).toMatchObject({ next_offset: null });
    expect(pageParties(all, 2, 50)).toEqual({ items: [], total: 4, next_offset: null });
  });
});

describe("PartyPageQuerySchema", () => {
  test("mặc định, trần limit 200 (vượt ⇒ lỗi, không cắt im lặng), khoá lạ bị từ chối", () => {
    expect(PartyPageQuerySchema.parse({})).toMatchObject({
      filter: "all",
      sort: "attention",
      limit: 20,
      offset: 0,
    });
    expect(PartyPageQuerySchema.safeParse({ limit: String(PARTY_PAGE_MAX) }).success).toBe(true);
    expect(PartyPageQuerySchema.safeParse({ limit: String(PARTY_PAGE_MAX + 1) }).success).toBe(
      false,
    );
    expect(PartyPageQuerySchema.safeParse({ filter: "bogus" }).success).toBe(false);
    expect(PartyPageQuerySchema.safeParse({ x: 1 }).success).toBe(false);
  });
});
