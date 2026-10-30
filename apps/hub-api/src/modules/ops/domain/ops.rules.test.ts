// CR-104 · ops-core · unit luật thuần ops-watch: đến hạn, giới hạn "Kiểm tra ngay", chuyển trạng thái nào báo chuông, dedup.
import { describe, expect, it } from "bun:test";
import { isDue, manualAllowed, notificationsFor, notifyKind, opsDedupKey } from "./ops.rules";

const T0 = new Date("2026-10-30T08:00:00Z");
const after = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("ops-watch · đến hạn lượt kiểm", () => {
  it("chưa từng kiểm ⇒ đến hạn; theo every_min tính từ lượt cuối", () => {
    expect(isDue(null, 30, T0)).toBe(true);
    expect(isDue(T0, 30, after(29))).toBe(false);
    expect(isDue(T0, 30, after(30))).toBe(true);
    expect(isDue(T0, 10, after(10))).toBe(true);
  });

  it("Kiểm tra ngay tối đa 1 lần/phút", () => {
    expect(manualAllowed(null, 60_000, T0)).toBe(true);
    expect(manualAllowed(T0, 60_000, new Date(T0.getTime() + 59_999))).toBe(false);
    expect(manualAllowed(T0, 60_000, after(1))).toBe(true);
  });
});

describe("ops-watch · chuyển trạng thái ⇒ chuông", () => {
  it("đổi sang warn/crit báo; hồi phục từ warn/crit báo; giữ nguyên hoặc unknown không báo", () => {
    expect(notifyKind("ok", "crit")).toBe("ops.crit");
    expect(notifyKind(null, "warn")).toBe("ops.warn");
    expect(notifyKind("warn", "crit")).toBe("ops.crit");
    expect(notifyKind("crit", "ok")).toBe("ops.recovered");
    expect(notifyKind("crit", "crit")).toBeNull();
    expect(notifyKind("ok", "unknown")).toBeNull();
    expect(notifyKind("unknown", "ok")).toBeNull();
    expect(notifyKind(null, "ok")).toBeNull();
  });

  it("mục chuông: tiêu đề theo nhãn check, dedup theo check+trạng thái+changed_at", () => {
    const items = notificationsFor([
      {
        check_key: "db_redis",
        from_status: "ok",
        to_status: "crit",
        changed_at: T0,
        message: "Redis không trả lời",
        hint: "docker compose ps",
      },
      {
        check_key: "disk",
        from_status: "ok",
        to_status: "ok",
        changed_at: T0,
        message: "",
        hint: null,
      },
    ]);
    expect(items).toEqual([
      {
        kind: "ops.crit",
        title: "Nghiêm trọng: DB / Redis",
        body: "Redis không trả lời\nGợi ý: docker compose ps",
        dedup_key: `ops:db_redis:crit:${T0.getTime()}`,
      },
    ]);
    expect(opsDedupKey("tls", "warn", T0)).toBe(`ops:tls:warn:${T0.getTime()}`);
  });
});
