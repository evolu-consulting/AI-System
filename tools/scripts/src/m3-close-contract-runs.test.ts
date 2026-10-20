// M3c · review B #2/#3 (unit): luật chạy script đóng run engine cũ — `--apply` DỪNG khi còn run chưa ánh xạ (trừ `--force`);
// `--verify` đỏ khi còn run mở (engine chưa quét); mặc định chạy thử.
import { describe, expect, test } from "bun:test";
import { planOf } from "./m3-close-contract-runs";

const c = (open: number, unmapped: number) => ({
  open,
  mapped: open - unmapped,
  unmapped,
  defs: 1,
});

describe("M3c · m3-close-contract-runs planOf", () => {
  test("mặc định chạy thử; --apply khi mọi run đã ánh xạ ⇒ apply", () => {
    expect(planOf(c(3, 0), [])).toBe("dry-run");
    expect(planOf(c(3, 0), ["--apply"])).toBe("apply");
  });
  test("#3 · còn run chưa ánh xạ ⇒ --apply bị chặn; --apply --force ⇒ apply", () => {
    expect(planOf(c(3, 1), ["--apply"])).toBe("blocked-unmapped");
    expect(planOf(c(3, 1), ["--apply", "--force"])).toBe("apply");
  });
  test("#2 · --verify: còn run mở ⇒ verify-open (thoát 1); hết ⇒ verify-ok", () => {
    expect(planOf(c(2, 0), ["--verify"])).toBe("verify-open");
    expect(planOf(c(0, 0), ["--verify"])).toBe("verify-ok");
  });
});
