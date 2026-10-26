// CR-097 D1 · luật thuần backfill + xem trước đổi mức (không DB).
import { describe, expect, it } from "bun:test";
import {
  assertConverged,
  assertRatingsUntouched,
  changedTotal,
  type Measure,
  parseFlags,
  report,
} from "./d1-backfill.rules";
import { oldLevels, previewLevels, previewLines } from "./d1-preview.rules";

const M: Measure = {
  rootMissing: 0,
  versionBad: 0,
  unlocked: 0,
  noDocument: 3,
  scoreRatings: 12,
  ratingEvents: 4,
};

describe("D1 backfill · cờ + bất biến", () => {
  it("--tenant bắt buộc; --dry-run bật cờ; khoá lạ bị từ chối", () => {
    expect(parseFlags(["--tenant", "nitigroup"])).toEqual({ tenant: "nitigroup", dryRun: false });
    expect(parseFlags(["--dry-run", "--tenant", "demo"]).dryRun).toBe(true);
    for (const bad of [[], ["--tenant"], ["--tenant", "--dry-run"], ["--tenant", "A b"]])
      expect(() => parseFlags(bad)).toThrow(/--tenant/);
  });

  it("sao đã nhập đổi ⇒ lỗi; giữ nguyên ⇒ qua", () => {
    expect(() => assertRatingsUntouched(M, { ...M })).not.toThrow();
    expect(() => assertRatingsUntouched(M, { ...M, scoreRatings: 11 })).toThrow(/sao đã nhập/);
    expect(() => assertRatingsUntouched(M, { ...M, ratingEvents: 0 })).toThrow(/sao đã nhập/);
  });

  it("hội tụ: còn hàng thiếu sau sửa ⇒ lỗi", () => {
    expect(() => assertConverged(M)).not.toThrow();
    expect(() => assertConverged({ ...M, unlocked: 1 })).toThrow(/vẫn còn/);
  });

  it("báo cáo: chạy thử nói 'sẽ đổi', tổng đúng; lần 2 (0 đổi) = 0", () => {
    const c = { root: 2, version: 1, locked: 4 };
    expect(changedTotal(c)).toBe(7);
    const dry = report("nitigroup", c, M, true);
    expect(dry[0]).toContain("CHẠY THỬ");
    expect(dry.join("\n")).toContain("sẽ đổi 2 hàng");
    expect(dry.at(-1)).toContain("tổng sẽ đổi: 7");
    expect(report("nitigroup", { root: 0, version: 0, locked: 0 }, M, false).at(-1)).toContain(
      "tổng đã đổi: 0",
    );
  });
});

describe("D1 preview · N đối tác đổi mức", () => {
  const lock = (
    party_key: string,
    role: string,
    level: string,
    period = "2026-09-01",
    jobs = 5,
  ) => ({
    party_key,
    role,
    grp: "service",
    period,
    level,
    jobs,
  });

  it("mức cũ: kỳ mới nhất, cùng kỳ lấy ô nhiều việc; commission_payer ≡ customer; mức lạ bỏ", () => {
    const m = oldLevels([
      lock("a", "customer", "watch", "2026-08-01"),
      lock("a", "customer", "good", "2026-09-01", 2),
      lock("a", "customer", "fair", "2026-09-01", 9),
      lock("p", "commission_payer", "watch"),
      lock("x", "supplier", "???"),
    ]);
    expect(m.get("customer|a")).toBe("fair");
    expect(m.get("customer|p")).toBe("watch");
    expect(m.has("supplier|x")).toBe(false);
  });

  it("đếm đối tác (không trùng) đổi mức; chưa có mức cũ không tính; 'new' khi điểm null", () => {
    const rows = [
      { party: "a", name: "A", role: "customer" as const, band: "good" as const },
      { party: "a", name: "A", role: "supplier" as const, band: "watch" as const },
      { party: "b", name: "B", role: "customer" as const, band: null, provisional: true },
      { party: "c", name: "C", role: "supplier" as const, band: "fair" as const, red_flag: true },
      { party: "d", name: "D", role: "customer" as const, band: "good" as const },
    ];
    const p = previewLevels(rows, [
      lock("a", "customer", "fair"),
      lock("a", "supplier", "watch"),
      lock("b", "customer", "good"),
      lock("c", "supplier", "fair"),
    ]);
    expect(p.partners_changed).toBe(2);
    expect(p.changes.map((c) => `${c.party}:${c.old}>${c.new}`)).toEqual([
      "a:fair>good",
      "b:good>new",
    ]);
    expect(p).toMatchObject({ compared: 3, no_old: 1, total: 4, red_flags: 1 });
    const lines = previewLines("nitigroup", p);
    expect(lines[0]).toContain("2 đối tác đổi mức");
    expect(lines[2]).toContain("MỚI · tạm tính");
  });

  it("tenant rỗng (NitiGroup đã xoá dữ liệu) ⇒ 0 đối tác đổi mức, không lỗi", () => {
    const p = previewLevels([], []);
    expect(p.partners_changed).toBe(0);
    expect(previewLines("nitigroup", p)).toHaveLength(1);
  });
});
