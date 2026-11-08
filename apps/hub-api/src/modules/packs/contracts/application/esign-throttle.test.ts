// CR-125 · cr125-esign-refresh-throttle · cửa sổ 10 s giữa hai lần hỏi nhà cung cấp cho cùng phong bì (đồng hồ giả, không ngủ chờ).
import { describe, expect, it } from "bun:test";
import { ESIGN_SYNC_GAP_MS, syncThrottle } from "./esign-throttle";

describe("syncThrottle", () => {
  it("vừa đồng bộ < 10 s ⇒ bỏ qua, đủ 10 s ⇒ cho gọi lại, phong bì khác không ảnh hưởng", () => {
    let t = Date.parse("2026-11-08T10:00:00Z");
    const g = syncThrottle(() => new Date(t));
    expect(g.recent("e1")).toBe(false);
    g.mark("e1");
    expect(g.recent("e1")).toBe(true);
    expect(g.recent("e2")).toBe(false);
    t += ESIGN_SYNC_GAP_MS - 1;
    expect(g.recent("e1")).toBe(true);
    t += 1;
    expect(g.recent("e1")).toBe(false);
  });
  it("mốc hết hạn được dọn khi ghi mốc mới (Map không phình)", () => {
    let t = 0;
    const g = syncThrottle(() => new Date(t), 1000);
    g.mark("a");
    t = 5000;
    g.mark("b");
    t = 5500;
    expect(g.recent("a")).toBe(false);
    expect(g.recent("b")).toBe(true);
  });
});
