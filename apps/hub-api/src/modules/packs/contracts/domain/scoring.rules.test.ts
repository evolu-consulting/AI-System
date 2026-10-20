// HD8-FR-01 · HD8-FR-02 · HD8-FR-03 · parity NGUYÊN VĂN `mgmt-app/api/tests/test_scoring_engine.py` (+ test_scoring_config,
// test_overdue L43-55): cùng sự kiện, cấu hình, hôm nay ⇒ cùng điểm/lý do. Số mong đợi tính theo `round()` Python (nửa về chẵn).
import { describe, expect, test } from "bun:test";
import { addDays } from "./local-time.rules";
import { band, type Ev, score } from "./scoring.rules";
import {
  type Criterion,
  choiceKey,
  defaultConfig,
  normalise,
  problem,
  type Rules,
  restorable,
  summary,
} from "./scoring-config.rules";

const TODAY = "2026-10-13";
const ev = (type: string, daysAgo = 30, kw: Partial<Ev> = {}): Ev => ({
  type,
  at: addDays(TODAY, -daysAgo),
  voided: false,
  ...kw,
});
const cust = (rules: Partial<Rules> = {}) => {
  const c = defaultConfig("customer");
  return { ...c, rules: { ...c.rules, ...rules } };
};
const sup = (rules: Partial<Rules> = {}) => {
  const c = defaultConfig("supplier");
  return { ...c, rules: { ...c.rules, ...rules } };
};
const paid = (on: number, late: number, lateDays = 5): Ev[] => [
  ...Array.from({ length: on }, (_, i) => ev("received", 20 + i * 25, { days_late: 0 })),
  ...Array.from({ length: late }, (_, i) => ev("received", 25 + i * 25, { days_late: lateDays })),
];
const times = <T>(n: number, x: T): T[] => Array.from({ length: n }, () => x);

describe("engine (test_scoring_engine.py)", () => {
  test("không đủ sự kiện ⇒ không chấm", () => {
    const r = score([ev("received", 30, { days_late: 0 })], cust(), TODAY, "customer");
    expect([r.score, r.band, r.reason]).toEqual([null, null, "Chưa đủ dữ liệu để chấm"]);
  });

  test("đúng hạn: tỉ lệ − 2 điểm mỗi ngày trễ trung bình", () => {
    const r = score(paid(11, 1, 6), cust({ recency_boost: false }), TODAY, "customer");
    // round(100*11/12 − 2*6/12) = round(90.67) = 91
    expect([r.breakdown.payment_on_time?.value, r.breakdown.payment_on_time?.detail]).toEqual([
      91,
      "Thanh toán đúng hạn 11/12 đợt",
    ]);
    expect(r.reason).toBe("Thanh toán đúng hạn 11/12 đợt");
  });

  test("chỉ tiêu chí có dữ liệu được tính, trọng số chia lại", () => {
    const r = score(paid(10, 0), cust(), TODAY, "customer");
    expect(r.score).toBe(100);
    expect(r.breakdown.cks_renewal?.value).toBeNull();
  });

  test("tiêu chí tắt bị bỏ", () => {
    const c = cust();
    const events = [...paid(5, 5), ...times(3, ev("complaint", 10))];
    const full = score(events, c, TODAY, "customer").score as number;
    const off = {
      ...c,
      criteria: c.criteria.map((x) => (x.key === "complaints" ? { ...x, enabled: false } : x)),
    };
    expect(score(events, off, TODAY, "customer").score as number).toBeGreaterThan(full);
  });
});

describe("engine (test_scoring_engine.py) · CKS, khoảng, chỉnh tay", () => {
  test("gia hạn CKS trễ 6 ngày = 40; mất khách = 0", () => {
    const r = score(
      [...paid(4, 0), ev("cks_renewed", 200, { days_before_expiry: -6, with_us: true })],
      cust(),
      TODAY,
      "customer",
    );
    expect(r.breakdown.cks_renewal?.value).toBe(40);
    const lapsed = score([...paid(4, 0), ev("cks_lapsed", 100)], cust(), TODAY, "customer");
    expect(lapsed.breakdown.cks_renewal?.value).toBe(0);
  });

  test("ngoài khoảng bỏ qua; gần đây tính gấp đôi", () => {
    const oldLate = times(5, ev("received", 400, { days_late: 10 }));
    expect(
      score([...paid(4, 0), ...oldLate], cust(), TODAY, "customer").breakdown.payment_on_time
        ?.value,
    ).toBe(100);
    const events = [
      ...times(2, ev("received", 30, { days_late: 0 })),
      ...times(2, ev("received", 200, { days_late: 0 })),
      ...times(2, ev("received", 200, { days_late: 4 })),
    ];
    const flat = score(events, cust({ recency_boost: false }), TODAY, "customer").breakdown
      .payment_on_time?.value as number;
    const boosted = score(events, cust(), TODAY, "customer").breakdown.payment_on_time
      ?.value as number;
    expect(boosted).toBeGreaterThan(flat);
  });
});

describe("engine (test_scoring_engine.py) · chỉnh tay, mức, nhắc", () => {
  test("chỉnh tay chặn ở ±10, điểm trong 0–100", () => {
    const base = paid(10, 0);
    const up = score(
      [...base, ev("manual_adjust", 5, { delta: 10 }), ev("manual_adjust", 6, { delta: 10 })],
      cust(),
      TODAY,
      "customer",
    );
    expect([up.score, up.adjust]).toEqual([100, 10]);
    const down = score(
      [...base, ev("manual_adjust", 5, { delta: -10 })],
      cust(),
      TODAY,
      "customer",
    );
    expect(down.score).toBe(90);
    const off = cust({ manual_adjust: false });
    expect(
      score([...base, ev("manual_adjust", 5, { delta: -10 })], off, TODAY, "customer").score,
    ).toBe(100);
  });

  test("dòng đã huỷ không tính; mức theo quy tắc", () => {
    const events = [...paid(3, 0), ...times(4, { ...ev("complaint", 5), voided: true })];
    expect(score(events, cust(), TODAY, "customer").score).toBe(100);
    const r = cust().rules;
    expect([band(80, r), band(79, r), band(59, r)]).toEqual(["good", "fair", "watch"]);
  });

  test("nhắc + dời hẹn giải thích khách cần chú ý; round(62.5) = 62 (nửa về chẵn)", () => {
    const events = [
      ...paid(8, 4, 8),
      ...Array.from({ length: 5 }, (_, i) => ev("reminded", 10 + i)),
      ...Array.from({ length: 3 }, (_, i) => ev("postponed", 40 + i)),
    ];
    const r = score(events, cust(), TODAY, "customer", { contracts: 2 });
    expect(r.reason).toBe("Phải nhắc thanh toán 5 lần, dời hẹn 3 lần");
    expect(r.breakdown.reminders?.value).toBe(62);
    expect(r.breakdown.appointments?.value).toBe(0);
  });
});

describe("engine (test_scoring_engine.py) · NCC, gắn bó", () => {
  test("NCC: giao hàng, nói trễ hay đúng hạn", () => {
    const late = [
      ...Array.from({ length: 34 }, (_, i) => ev("delivered", 5 + i * 8, { days_late: 0 })),
      ...Array.from({ length: 6 }, (_, i) => ev("delivered", 9 + i * 8, { days_late: 2 })),
    ];
    const r = score(late, sup({ recency_boost: false }), TODAY, "supplier");
    expect([r.reason, r.breakdown.delivery_on_time?.value]).toEqual(["Giao trễ 6/40 lần", 84]);
    const good = [
      ...Array.from({ length: 95 }, (_, i) => ev("delivered", 3 + i * 3, { days_late: 0 })),
      ...times(3, ev("delivered", 4, { days_late: 1 })),
    ];
    expect(score(good, sup(), TODAY, "supplier").reason).toBe("Giao đúng hạn 95/98 lần");
  });

  test("gắn bó: năm + gia hạn", () => {
    const r = score(paid(4, 0), cust(), TODAY, "customer", {
      first_start: "2023-10-01",
      contracts: 3,
    });
    expect([r.breakdown.tenure?.value, r.breakdown.tenure?.detail]).toEqual([
      100,
      "Hợp tác 3 năm, gia hạn 2 lần",
    ]);
    const fresh = score(paid(4, 0), cust(), TODAY, "customer", {
      first_start: "2026-04-13",
      contracts: 1,
    });
    expect(fresh.breakdown.tenure?.value).toBe(50);
  });
});

const withQuality = (weight = 20) => {
  const c = cust();
  const criteria: Criterion[] = c.criteria.map((x, i) =>
    i === 0 ? { ...x, weight: x.weight - weight } : x,
  );
  criteria.push(
    ...normalise([{ key: "custom:q", kind: "manual", label: "Chất lượng", enabled: true, weight }]),
  );
  return { ...c, criteria };
};
const rating = (value: number, daysAgo = 5, criterion = "custom:q", kw: Partial<Ev> = {}) =>
  ev("rating", daysAgo, { criterion, value, by: "a@x", ...kw });

describe("tiêu chí tự chấm (test_scoring_engine.py L124-165)", () => {
  test("lần chấm mới nhất trong khoảng", () => {
    const c = withQuality(20);
    const base = paid(10, 0);
    const r = score([...base, rating(10, 40), rating(40, 3)], c, TODAY, "customer");
    const q = r.breakdown["custom:q"];
    expect([q?.value, q?.label, q?.by]).toEqual([40, "Chất lượng", "a@x"]);
    expect(r.score).toBe(80); // round((100*40 + 40*20) / 60)
    expect(r.event_count).toBe(10);
    const same = score(
      [
        ...base,
        rating(90, 3, "custom:q", { rated_at: "2026-10-10T09:00" }),
        rating(30, 3, "custom:q", { rated_at: "2026-10-10T10:00" }),
      ],
      c,
      TODAY,
      "customer",
    );
    expect(same.breakdown["custom:q"]?.value).toBe(30);
  });

  test("chưa giao dịch nhưng được chấm ⇒ có điểm", () => {
    const c = withQuality(20);
    expect(score([], c, TODAY, "customer").score).toBeNull();
    const r = score([rating(85)], c, TODAY, "customer");
    expect([r.score, r.band]).toEqual([85, "good"]);
    const t = score([rating(60)], c, TODAY, "customer", {
      first_start: "2023-10-01",
      contracts: 3,
    });
    expect(t.score).toBe(73); // round((60*20 + 100*10) / 30)
  });
});

describe("tiêu chí tự chấm (test_scoring_engine.py L124-165) · bỏ, chi tiết", () => {
  test("chưa chấm / quá khoảng / đã huỷ / tiêu chí khác ⇒ bỏ tiêu chí tự chấm", () => {
    const c = withQuality(20);
    const r = score(paid(10, 0), c, TODAY, "customer");
    expect([r.breakdown["custom:q"]?.value, r.score]).toEqual([null, 100]);
    expect(score([...paid(10, 0), rating(0, 400)], c, TODAY, "customer").score).toBe(100);
    expect(
      score([...paid(10, 0), { ...rating(0), voided: true }], c, TODAY, "customer").score,
    ).toBe(100);
    const other = score([...paid(10, 0), rating(0, 5, "custom:other")], c, TODAY, "customer");
    expect(other.score).toBe(100);
    expect("custom:other" in other.breakdown).toBe(false);
  });

  test("bảng chi tiết theo nhãn cấu hình, bỏ tiêu chí đã xoá", () => {
    const c = cust();
    const crit = normalise(
      c.criteria
        .filter((x) => x.key !== "tenure")
        .map((x, i) => (i === 0 ? { ...x, label: "Trả tiền đúng hạn", weight: x.weight + 10 } : x)),
    );
    const r = score(paid(5, 0), { ...c, criteria: crit }, TODAY, "customer", {
      first_start: "2020-01-01",
    });
    expect("tenure" in r.breakdown).toBe(false);
    expect(r.breakdown.payment_on_time?.label).toBe("Thanh toán đúng hạn");
  });
});

describe("tiêu chí tự chấm (test_scoring_engine.py L124-165) · giá NCC", () => {
  test("giá NCC: khoảng cách tới nơi rẻ nhất", () => {
    const events = Array.from({ length: 4 }, (_, i) => ev("delivered", 5 + i, { days_late: 0 }));
    const cheapest = score(events, sup(), TODAY, "supplier", { price_gap_pct: 0 });
    expect([cheapest.breakdown.price?.value, cheapest.breakdown.price?.detail]).toEqual([
      100,
      "Giá rẻ nhất",
    ]);
    const dear = score(events, sup(), TODAY, "supplier", { price_gap_pct: 4.2 });
    expect([dear.breakdown.price?.value, dear.breakdown.price?.detail]).toEqual([
      79,
      "Đắt hơn 4.2%",
    ]);
    // test_scoring_ratings L106-110: heo 110.000 so 100.000 ⇒ 10% ⇒ (50, "Đắt hơn 10.0%")
    const ten = score(events, sup(), TODAY, "supplier", {
      price_gap_pct: (100 * (110_000 - 100_000)) / 100_000,
    });
    expect([ten.breakdown.price?.value, ten.breakdown.price?.detail]).toEqual([
      50,
      "Đắt hơn 10.0%",
    ]);
    expect(score(events, sup(), TODAY, "supplier", {}).breakdown.price?.value).toBeNull();
  });
});

describe("dòng quá hạn chưa trả lời tính như trễ (test_overdue.py L43-55, hôm nay 2026-10-20)", () => {
  const T2 = "2026-10-20";
  const at = (d: string, kw: Partial<Ev>): Ev => ({ at: d, voided: false, type: "x", ...kw });
  const onTime3 = ["2026-10-05", "2026-10-06", "2026-10-07"].map((d) =>
    at(d, { type: "received", days_late: 0 }),
  );
  const od = at("2026-10-02", {
    type: "overdue",
    obligation_id: "o1",
    party_late: true,
    due_date: "2026-10-01",
    kind: "payment",
  });
  test("3 đúng hạn + 1 quá hạn đang treo ⇒ < 90, 3/4; trả trễ 11 ngày ⇒ vẫn 3/4, điểm cao hơn", () => {
    const pend = score([...onTime3, od], cust(), T2, "customer").breakdown.payment_on_time;
    expect(pend?.detail).toContain("3/4");
    expect(pend?.value as number).toBeLessThan(90);
    const paidLate = at("2026-10-12", { type: "received", days_late: 11, obligation_id: "o1" });
    const after = score([...onTime3, od, paidLate], cust(), T2, "customer").breakdown
      .payment_on_time;
    expect(after?.detail).toContain("3/4");
    expect(after?.value as number).toBeGreaterThan(pend?.value as number);
  });
  test("party_late = false ⇒ không tính trễ", () => {
    const mine = { ...od, party_late: false };
    expect(score([...onTime3, mine], cust(), T2, "customer").breakdown.payment_on_time?.value).toBe(
      100,
    );
  });
});

describe("cấu hình (test_scoring_config.py)", () => {
  test("kiểm hợp lệ", () => {
    const c = cust();
    expect(problem("customer", c.criteria, c.rules)).toBeNull();
    const plus = c.criteria.map((x, i) => (i === 0 ? { ...x, weight: x.weight + 1 } : x));
    expect(problem("customer", plus, c.rules)).toBe("Tổng trọng số phải đúng 100%");
    const r = cust({ good_from: 50, fair_from: 60 });
    expect(problem("customer", r.criteria, r.rules)).toBe("Mức Tốt phải cao hơn mức Khá");
  });
  test("khoá lựa chọn tự chấm; khôi phục tiêu chí có sẵn", () => {
    expect(choiceKey("Tốc độ phản hồi")).toBe("custom:toc-do-phan-hoi");
    expect(choiceKey("Đóng gói, bảo quản")).toBe("custom:dong-goi-bao-quan");
    const c = cust();
    expect(
      restorable(
        "customer",
        c.criteria.filter((x) => x.key !== "tenure"),
      ),
    ).toEqual([{ key: "tenure", label: "Gắn bó", weight: 10 }]);
  });
  test("tự chấm ngoài danh sách / nhãn trùng / khoá lạ bị từ chối", () => {
    const c = cust();
    const free = normalise([
      ...c.criteria.map((x, i) => (i === 0 ? { ...x, weight: x.weight - 10 } : x)),
      { kind: "manual", label: "Tự đặt", enabled: true, weight: 10 },
    ]);
    expect(problem("customer", free, c.rules)).toBe(
      "Chọn tiêu chí tự chấm trong danh sách: Tự đặt không có",
    );
    const alien = normalise([{ key: "price", enabled: true, weight: 100 }]);
    expect(problem("customer", alien, c.rules)).toBe("Tiêu chí có sẵn không hợp lệ: price");
  });
  test("tóm tắt lịch sử (test_scoring_routes L33-62: «Số lần phải nhắc 15→20%»)", () => {
    const c = cust();
    const after = c.criteria.map((x) =>
      x.key === "reminders"
        ? { ...x, weight: 20 }
        : x.key === "complaints"
          ? { ...x, weight: 5 }
          : x,
    );
    expect(summary(c, { criteria: after, rules: c.rules })).toContain("Số lần phải nhắc 15→20%");
    expect(summary(c, c)).toBe("lưu lại, không đổi");
    expect(summary(c, { criteria: c.criteria, rules: { ...c.rules, recency_boost: false } })).toBe(
      "recency_boost True→False",
    );
  });
});
