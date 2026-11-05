// CR-121 C-3b · unit hàm thuần của Tổng quan platform.
import { describe, expect, test } from "bun:test";
import type { OpsOverview } from "@ai/contracts/hub-admin";
import {
  attentionRows,
  deltaOf,
  fmtDec,
  healthTiles,
  hourBars,
  resolveLink,
  sparkPoints,
} from "./ops-overview";

const attention: OpsOverview["attention"] = {
  stuck_runs: { count: 2, hours: 4, link: "/runs?filter=attention&hours=4" },
  unrouted_companies: { count: 0, link: "/tenants?filter=unrouted" },
  failing_ai_tools: { count: 1, streak: 3, link: "/workflows?filter=failing" },
  near_quota_companies: { count: 0, pct: 80, link: "/tenants?filter=near_quota" },
  half_configured: { count: 0, link: "/tenants?filter=half_configured" },
};

describe("ops-overview", () => {
  test("fmtDec theo ngôn ngữ, null giữ null", () => {
    expect(fmtDec(3.24, "vi")).toBe("3,2");
    expect(fmtDec(3.24, "en")).toBe("3.2");
    expect(fmtDec(null, "vi")).toBeNull();
  });

  test("deltaOf: thiếu số hôm qua = none (không phải 0)", () => {
    expect(deltaOf(5, null).dir).toBe("none");
    expect(deltaOf(5, 5).dir).toBe("flat");
    expect(deltaOf(3.2, 1.1)).toEqual({ dir: "up", diff: 2.1 });
    expect(deltaOf(1, 4)).toEqual({ dir: "down", diff: 3 });
  });

  test("sparkPoints: ít hơn 2 điểm có số thì rỗng, bỏ qua null, chuỗi phẳng ở giữa", () => {
    expect(sparkPoints([null, null, 3, null, null, null, null])).toBe("");
    expect(sparkPoints([1, 1, 1, 1, 1, 1, 1]).split(" ")).toHaveLength(7);
    expect(sparkPoints([1, 1, 1, 1, 1, 1, 1]).startsWith("0.0,14.0")).toBe(true);
    const p = sparkPoints([0, null, 10, 0, 0, 0, 5]).split(" ");
    expect(p).toHaveLength(6);
    expect(p[0]).toBe("0.0,26.0");
    expect(p[1]).toBe("33.3,2.0");
  });

  test("hourBars: cột cao nhất = 100%, giờ trống = 0, lỗi có tối thiểu 6%", () => {
    const hourly = Array.from({ length: 24 }, (_, i) => ({
      hour_start: `h${i}`,
      ok: i === 0 ? 20 : 0,
      error: i === 0 ? 1 : 0,
    }));
    const { bars, total } = hourBars(hourly);
    expect(total).toBe(21);
    expect(bars[0]?.okPct).toBe(100);
    expect(bars[0]?.errPct).toBe(6);
    expect(bars[1]).toMatchObject({ okPct: 0, errPct: 0 });
  });

  test("resolveLink: chỉ link tới trang đã có, trang chưa có thì null", () => {
    expect(resolveLink("/runs?filter=attention&hours=4")).toBeNull();
    expect(resolveLink("/tenants?filter=unrouted")).toEqual({
      to: "/tenants",
      search: { filter: "unrouted" },
    });
    expect(resolveLink("/system")).toEqual({ to: "/system" });
  });

  test("attentionRows: tách có việc / đã ổn, giữ tham số cho nhãn", () => {
    const r = attentionRows(attention);
    expect(r.active.map((x) => x.key)).toEqual(["stuck_runs", "failing_ai_tools"]);
    expect(r.active[0]?.params).toEqual({ n: 2, hours: 4 });
    expect(r.active[0]?.link).toBeNull();
    expect(r.active[1]?.link?.to).toBe("/workflows");
    expect(r.ok).toEqual(["unrouted_companies", "near_quota_companies", "half_configured"]);
  });

  test("healthTiles: mức theo ngưỡng, Dify không có lượt gọi ⇒ none", () => {
    const base: OpsOverview["health"] = {
      queue: { lag_s: 400, queued: 3, oldest_wait_s: 50, timer_overdue_s: 0 },
      dify: { error_rate_1h: null, calls_1h: 0, errors_24h: 0, top_failing_tool: null },
      db: {
        ok: true,
        ping_ms: 2,
        slow_query_ms: null,
        connections: 9,
        max_connections: 10,
        size_bytes: 1,
      },
      deploy: { version: null, checked_at: null },
    };
    const t = healthTiles(base, "vi", "—");
    expect(t.map((x) => x.level)).toEqual(["warn", "none", "warn", "none"]);
    expect(t[3]?.value).toBe("—");
    const ok = healthTiles({ ...base, db: { ...base.db, ok: false } }, "vi", "—");
    expect(ok[2]?.level).toBe("bad");
  });
});
