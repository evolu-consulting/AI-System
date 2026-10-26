// CR-097a · U1 (BA R34–R38, R43, X6) · bảng engine HD8 theo BA hợp đồng–đối tác: trung bình theo trọng số chuẩn hoá lại khi tắt bớt,
// ngoài window_months bỏ, trong recency_months nhân recency_boost (×2), dưới min_events ⇒ null, manual_adjust kẹp ±10, band 80/60,
// lý do một dòng theo mẫu. Bổ sung cho parity mgmt ở `scoring.rules.test.ts` — mỗi dòng bảng một ca, số tính tay.
import { describe, expect, test } from "bun:test";
import { addDays } from "./local-time.rules";
import { band, type Ev, score } from "./scoring.rules";
import { defaultConfig, RULES, type Rules } from "./scoring-config.rules";

const TODAY = "2026-10-13";
const ev = (type: string, daysAgo: number, kw: Partial<Ev> = {}): Ev => ({
  type,
  at: addDays(TODAY, -daysAgo),
  voided: false,
  ...kw,
});
const cfg = (role: "customer" | "supplier", rules: Partial<Rules> = {}) => {
  const c = defaultConfig(role);
  return { ...c, rules: { ...c.rules, ...rules } };
};
const cust = (rules: Partial<Rules> = {}) => cfg("customer", rules);
const at = { today: TODAY, role: "customer" as const };
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

describe("R38 · mặc định BA 80/60 và band", () => {
  test("RULES mặc định: good_from 80, fair_from 60, min_events 3, window 12, boost ×2 trong 3 tháng, chỉnh tay bật", () => {
    expect(RULES).toEqual({
      good_from: 80,
      fair_from: 60,
      min_events: 3,
      window_months: 12,
      recency_boost: true,
      recency_months: 3,
      manual_adjust: true,
    });
  });

  test("≥ 80 Tốt · ≥ 60 Khá · còn lại Chú ý; null ⇒ không band", () => {
    const r = RULES;
    expect([100, 80, 79, 60, 59, 0].map((s) => band(s, r))).toEqual([
      "good",
      "good",
      "fair",
      "fair",
      "watch",
      "watch",
    ]);
    expect(band(null, r)).toBeNull();
    expect(band(70, { ...r, good_from: 70 })).toBe("good"); // ngưỡng theo cấu hình
  });
});

describe("R35 · window_months và recency_boost", () => {
  test("ngoài 12 tháng bị bỏ: chỉ 5 sự kiện trong khoảng được đếm", () => {
    const events = [
      ...times(5, ev("received", 30, { days_late: 0 })),
      ...times(4, ev("received", 400, { days_late: 9 })),
    ];
    const r = score(events, cust(), at);
    expect(r.event_count).toBe(5);
    expect(r.breakdown.payment_on_time?.detail).toBe("Thanh toán đúng hạn 5/5 đợt");
    expect(r.score).toBe(100);
    // đổi cửa sổ 24 tháng ⇒ các dòng cũ vào tính
    expect(score(events, cust({ window_months: 24 }), at).event_count).toBe(9);
  });

  test("trong 3 tháng gần nhất nhân ×2: 1 đợt trễ 10 ngày gần đây + 3 đợt đúng hạn cũ", () => {
    const events = [
      ev("received", 10, { days_late: 10 }),
      ...times(3, ev("received", 200, { days_late: 0 })),
    ];
    // có boost: w = 3 + 2·1 = 5, đúng hạn 3, trễ TB = 2·10/5 = 4 ⇒ 100·3/5 − 2·4 = 52
    expect(score(events, cust(), at).breakdown.payment_on_time?.value).toBe(52);
    // tắt boost: w = 4, trễ TB = 10/4 = 2,5 ⇒ 75 − 5 = 70
    expect(score(events, cust({ recency_boost: false }), at).breakdown.payment_on_time?.value).toBe(
      70,
    );
  });
});

describe("R34 · trung bình theo trọng số, chuẩn hoá lại khi tắt bớt", () => {
  // đúng hạn 100 (3 đợt), khiếu nại 2 lần ⇒ 100 − 25·2 = 50; nhắc 0 ⇒ 100; hẹn: chưa có ⇒ bỏ
  const events = [
    ...times(3, ev("received", 30, { days_late: 0 })),
    ...times(2, ev("complaint", 20)),
  ];
  const w = (c: ReturnType<typeof cust>, key: string) =>
    c.criteria.find((x) => x.key === key)?.weight ?? 0;

  test("chỉ tiêu chí bật + có dữ liệu được tính; tắt khiếu nại ⇒ điểm tăng", () => {
    const c = cust();
    const full = score(events, c, at);
    expect(full.breakdown.complaints?.value).toBe(50);
    const on = c.criteria.filter((x) => x.enabled && x.weight > 0);
    expect(on.length).toBeGreaterThan(2);
    expect(w(c, "complaints")).toBeGreaterThan(0);
    const off = {
      ...c,
      criteria: c.criteria.map((x) => (x.key === "complaints" ? { ...x, enabled: false } : x)),
    };
    const r = score(events, off, at);
    expect(r.score as number).toBeGreaterThan(full.score as number);
    expect(r.score).toBe(100); // còn lại đều 100 ⇒ chuẩn hoá lại, không chia cho tổng cũ
  });
});

describe("R36 · dưới min_events ⇒ score null", () => {
  test("2 sự kiện ⇒ null + lý do; 3 sự kiện ⇒ có điểm", () => {
    const two = score(times(2, ev("received", 10, { days_late: 0 })), cust(), at);
    expect([two.score, two.band, two.reason, two.event_count]).toEqual([
      null,
      null,
      "Chưa đủ dữ liệu để chấm",
      2,
    ]);
    const three = score(times(3, ev("received", 10, { days_late: 0 })), cust(), at);
    expect([three.score, three.band]).toEqual([100, "good"]);
    // đổi min_events = 5 ⇒ 3 sự kiện vẫn null
    expect(
      score(times(3, ev("received", 10, { days_late: 0 })), cust({ min_events: 5 }), at).score,
    ).toBeNull();
  });
});

describe("R37 · manual_adjust cộng thẳng, kẹp ±10", () => {
  const base = times(4, ev("received", 10, { days_late: 5 })); // 100·0 − … ⇒ điểm thấp, còn chỗ cộng
  test("+25 ⇒ kẹp +10; −25 ⇒ kẹp −10; tắt manual_adjust ⇒ 0", () => {
    const plain = score(base, cust(), at);
    const up = score([...base, ev("manual_adjust", 3, { delta: 25 })], cust(), at);
    const down = score([...base, ev("manual_adjust", 3, { delta: -25 })], cust(), at);
    expect([up.adjust, down.adjust]).toEqual([10, -10]);
    expect(up.score).toBe(Math.min(100, (plain.score as number) + 10));
    expect(down.score).toBe(Math.max(0, (plain.score as number) - 10));
    const off = score(
      [...base, ev("manual_adjust", 3, { delta: 25 })],
      cust({ manual_adjust: false }),
      at,
    );
    expect([off.adjust, off.score]).toEqual([0, plain.score]);
  });
});

describe("R43 · lý do một dòng theo mẫu", () => {
  test("khách: Thanh toán đúng hạn 11/12 đợt; ≥ 5 lần nhắc/dời ⇒ Phải nhắc thanh toán N lần, dời hẹn M lần", () => {
    const paid = [
      ...times(11, ev("received", 40, { days_late: 0 })),
      ev("received", 41, { days_late: 6 }),
    ];
    expect(score(paid, cust({ recency_boost: false }), at).reason).toBe(
      "Thanh toán đúng hạn 11/12 đợt",
    );
    const nag = [...paid, ...times(5, ev("reminded", 15))];
    expect(score(nag, cust(), at).reason).toBe("Phải nhắc thanh toán 5 lần, dời hẹn 0 lần");
  });

  test("NCC: Giao đúng hạn x/y lần khi trễ ≤ 5%, ngược lại Giao trễ n/y lần", () => {
    const sup = (late: number, on: number) => [
      ...times(on, ev("delivered", 30, { days_late: 0 })),
      ...times(late, ev("delivered", 35, { days_late: 4 })),
    ];
    const s = { today: TODAY, role: "supplier" as const };
    expect(score(sup(0, 4), cfg("supplier"), s).reason).toBe("Giao đúng hạn 4/4 lần");
    expect(score(sup(2, 3), cfg("supplier"), s).reason).toBe("Giao trễ 2/5 lần");
  });

  test("giữ/lỡ hẹn = kept/(kept+postponed+missed); khiếu nại đếm số lần", () => {
    const events = [
      ...times(3, ev("received", 20, { days_late: 0 })),
      ...times(2, ev("appointment_kept", 20)),
      ev("postponed", 20),
      ev("appointment_missed", 20),
      ...times(2, ev("complaint", 20)),
    ];
    const r = score(events, cust(), at);
    expect(r.breakdown.appointments?.detail).toBe("Giữ hẹn 2/4 lần");
    expect(r.breakdown.complaints?.detail).toBe("2 lần khiếu nại");
  });
});
