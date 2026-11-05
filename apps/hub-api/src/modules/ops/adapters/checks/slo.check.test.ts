// CR-117 · unit: đánh giá check `slo` (nguồn → mẫu, mẫu → trạng thái qua nhiều lượt) — không DB, không mạng.
import { describe, expect, it } from "bun:test";
import { SLO_DEFS } from "../../domain/slo.rules";
import { evaluateSlo, nextStates } from "./slo.check";
import { MIN_LOG_LINES, samplesFromDb, samplesFromHost } from "./slo.sources";

const NOW = new Date("2026-11-05T10:00:00Z");
const host = (over: Record<string, unknown> = {}) =>
  ({
    kind: "ok",
    data: { at: NOW.toISOString(), window_min: 30, log: { lines: 1000, errors: 20 }, ...over },
  }) as never;

describe("samplesFromHost", () => {
  it("tỷ lệ lỗi log (%) và p95 contracts.list khi đủ mẫu", () => {
    const s = samplesFromHost(
      host({ routes: { "contracts.list": { n: 40, p95_ms: 812.4 } } }),
      NOW,
    );
    expect(s).toEqual({ log_error_rate: 2, contracts_list_p95: 812.4 });
  });
  it("quá ít dòng log / route ít request / file cũ / thiếu file ⇒ null", () => {
    const few = samplesFromHost(
      host({
        log: { lines: MIN_LOG_LINES - 1, errors: 9 },
        routes: { "contracts.list": { n: 3, p95_ms: 9999 } },
      }),
      NOW,
    );
    expect(few).toEqual({ log_error_rate: null, contracts_list_p95: null });
    const old = samplesFromHost(
      host({ at: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() }),
      NOW,
    );
    expect(old.log_error_rate).toBeNull();
    expect(samplesFromHost({ kind: "missing" }, NOW).log_error_rate).toBeNull();
  });
});

describe("samplesFromDb", () => {
  it("trễ timer = max(p95 đã bắn, trễ hiện tại); không timer ⇒ null; không job ⇒ null", () => {
    const s = samplesFromDb({
      dispatch_p50_ms: 420.456,
      dispatch_n: 5,
      timer_fired_p95_s: 3,
      timer_overdue_s: 900,
    });
    expect(s).toEqual({ chat_dispatch_p50: 420.46, timer_lag_p95: 900 });
    const none = samplesFromDb({
      dispatch_p50_ms: null,
      dispatch_n: 0,
      timer_fired_p95_s: null,
      timer_overdue_s: null,
    });
    expect(none).toEqual({ chat_dispatch_p50: null, timer_lag_p95: null });
    expect(samplesFromDb(undefined).timer_lag_p95).toBeNull();
  });
});

describe("evaluateSlo qua nhiều lượt", () => {
  const bad = {
    log_error_rate: 5,
    contracts_list_p95: 100,
    chat_dispatch_p50: 200,
    timer_lag_p95: 1,
  };
  const good = { ...bad, log_error_rate: 0.1 };
  const step = (prev: ReturnType<typeof nextStates>, s: Record<string, number>) => {
    const states = nextStates(SLO_DEFS, new Map(prev.map((x) => [x.id, x])), s);
    return { states, r: evaluateSlo(states, SLO_DEFS, 2, 4) };
  };
  it("lỗi log vượt 1% N lượt liên tiếp: ok → warn (2) → crit (4); hồi phục khi tốt lại", () => {
    let st = step([], bad);
    expect(st.r.status).toBe("ok");
    st = step(st.states, bad);
    expect(st.r.status).toBe("warn");
    expect(st.r.message).toContain("tỷ lệ lỗi log");
    st = step(st.states, bad);
    st = step(st.states, bad);
    expect(st.r.status).toBe("crit");
    expect(st.r.hint).toBeTruthy();
    st = step(st.states, good);
    expect(st.r.status).toBe("ok");
  });
  it("không có số đo nào ⇒ unknown", () => {
    const states = nextStates(SLO_DEFS, new Map(), {});
    expect(evaluateSlo(states, SLO_DEFS, 2, 4).status).toBe("unknown");
  });
});
