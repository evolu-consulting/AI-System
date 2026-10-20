// W1 · bộ nhớ đệm "Mua hàng" (review B #17): lượt nạp dùng chung khoá theo tenant + dấu vân tay + ngày; dòng dựng nhớ theo tập thấy.
import { describe, expect, it } from "bun:test";
import { createSourcingCache, type SourcingEntry, VIEWS_MAX, viewOf } from "./sourcing-cache";

const entry = (fp: string): SourcingEntry => ({
  fp,
  today: "2026-10-20",
  raw: { contracts: [], choices: [], truncated: false },
  views: new Map(),
});

describe("W1 · sourcing-cache", () => {
  it("cùng tenant + dấu vân tay ⇒ MỘT lượt nạp; dấu vân tay mới ⇒ lượt nạp riêng (không nhập lượt cũ)", async () => {
    const cache = createSourcingCache();
    let loads = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slow = (fp: string) => async () => {
      loads++;
      await gate;
      return entry(fp);
    };
    const key = (fp: string) => ({ fp, today: "2026-10-20" });
    const a = cache.fill("t1", key("v1"), slow("v1"));
    const b = cache.fill("t1", key("v1"), slow("v1"));
    const c = cache.fill("t1", key("v2"), slow("v2"));
    release();
    const [ea, eb, ec] = await Promise.all([a, b, c]);
    expect(loads).toBe(2);
    expect(ea).toBe(eb);
    expect(ec.fp).toBe("v2");
  });
  it("viewOf: cùng tập thấy (khác thứ tự) dùng lại; tập khác dựng riêng; tối đa VIEWS_MAX tập", () => {
    const e = entry("v1");
    let builds = 0;
    const build = () => {
      builds++;
      return [];
    };
    const x = viewOf(e, ["b", "a"], build);
    expect(viewOf(e, ["a", "b"], build)).toBe(x);
    viewOf(e, ["a"], build);
    expect(builds).toBe(2);
    for (let i = 0; i < VIEWS_MAX + 3; i++) viewOf(e, [`k${i}`], build);
    expect(e.views.size).toBe(VIEWS_MAX);
  });
});
