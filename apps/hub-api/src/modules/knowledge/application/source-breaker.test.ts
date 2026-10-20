// R1 · F-09: ngắt mạch nguồn ngoài — đồng hồ giả, không chờ giờ thật (Luật 4c).
import { describe, expect, it } from "bun:test";
import type { ExternalSource } from "./ports";
import { SourceOpenError, withBreaker } from "./source-breaker";

function flaky() {
  const s = { calls: 0, fail: true };
  const src: ExternalSource = {
    name: "kh",
    allows: () => true,
    search: async () => {
      s.calls++;
      if (s.fail) throw new Error("timeout");
      return [];
    },
  };
  return { s, src };
}

describe("F-09 · withBreaker", () => {
  it("3 lỗi liên tiếp ⇒ mở mạch 30 s (không gọi mạng); hết hạn ⇒ thử lại; thành công ⇒ đóng", async () => {
    let t = 0;
    const { s, src } = flaky();
    const b = withBreaker(src, { failures: 3, coolMs: 30_000, now: () => t });
    for (let i = 0; i < 3; i++) await expect(b.search("q", 5)).rejects.toThrow("timeout");
    await expect(b.search("q", 5)).rejects.toBeInstanceOf(SourceOpenError);
    expect(s.calls).toBe(3);
    t = 30_001;
    s.fail = false;
    expect(await b.search("q", 5)).toEqual([]);
    expect(s.calls).toBe(4);
    s.fail = true;
    await expect(b.search("q", 5)).rejects.toThrow("timeout"); // đã đóng: đếm lại từ 0
    expect(await b.search("q", 5).catch((e) => e.name)).toBe("Error");
  });

  it("lỗi xen kẽ thành công ⇒ không mở mạch", async () => {
    const { s, src } = flaky();
    const b = withBreaker(src, { failures: 2, now: () => 0 });
    await expect(b.search("q", 5)).rejects.toThrow();
    s.fail = false;
    await b.search("q", 5);
    s.fail = true;
    await expect(b.search("q", 5)).rejects.toThrow("timeout");
    expect(s.calls).toBe(3);
  });
});
