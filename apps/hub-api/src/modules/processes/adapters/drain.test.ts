// HUB-FR-143 · Luật 4c · T7: `DrainTracker` — `settled()` resolve đúng lúc bộ đếm về 0, không timer.
import { describe, expect, it } from "bun:test";
import { DrainTracker } from "./drain";

/** Promise mở từ ngoài (tín hiệu tay, không chờ giờ). */
function gate(): { p: Promise<void>; open: () => void } {
  let open = () => {};
  const p = new Promise<void>((r) => {
    open = r;
  });
  return { p, open };
}

describe("DrainTracker · handles.settled [HUB-FR-143]", () => {
  it("HUB-FR-143 · rảnh ⇒ settled resolve ngay", async () => {
    await new DrainTracker().settled();
    expect(true).toBe(true);
  });

  it("HUB-FR-143 · 2 việc đang chạy ⇒ settled chỉ resolve sau việc cuối", async () => {
    const t = new DrainTracker();
    const a = gate();
    const b = gate();
    const order: string[] = [];
    const ra = t.run(() => a.p.then(() => void order.push("a")));
    const rb = t.run(() => b.p.then(() => void order.push("b")));
    const s = t.settled().then(() => void order.push("settled"));
    a.open();
    await ra;
    expect(order).toEqual(["a"]);
    b.open();
    await Promise.all([rb, s]);
    expect(order).toEqual(["a", "b", "settled"]);
  });

  it("HUB-FR-143 · việc ném lỗi vẫn giảm bộ đếm; run trả nguyên lỗi", async () => {
    const t = new DrainTracker();
    const g = gate();
    const r = t.run(async () => {
      await g.p;
      throw new Error("x");
    });
    const s = t.settled();
    g.open();
    await expect(r).rejects.toThrow("x");
    await s;
    expect(await t.run(async () => 7)).toBe(7);
  });
});
