// HD8-FR-03 · luật bản nháp của trang Cách tính điểm (mgmt `ScoringPage.tsx:36-69,209`).
import { describe, expect, test } from "bun:test";
import type { ScoreConfigOut } from "@ai/contracts";
import { choicesOf, isDirty, restorableOf, toInt, totalOf, wentUp } from "./scoring";

const rules = {
  good_from: 80,
  fair_from: 60,
  min_events: 3,
  window_months: 12,
  recency_boost: true,
  recency_months: 3,
  manual_adjust: true,
};
const cfg: ScoreConfigOut = {
  role: "customer",
  version: 1,
  criteria: [
    {
      key: "payment_on_time",
      kind: "auto",
      label: "Thanh toán đúng hạn",
      enabled: true,
      weight: 70,
    },
    { key: "reminders", kind: "auto", label: "Số lần phải nhắc", enabled: false, weight: 30 },
    { key: "custom:de-lam-viec", kind: "manual", label: "Dễ làm việc", enabled: true, weight: 30 },
  ],
  rules,
  updated_by: null,
  updated_at: null,
  restorable: [{ key: "tenure", label: "Gắn bó", weight: 10 }],
  manual_choices: ["Dễ làm việc", "Thái độ hợp tác"],
};

describe("bản nháp cách tính", () => {
  test("tổng chỉ tính tiêu chí bật; đã đổi khi khác cấu hình lưu", () => {
    const d = { criteria: cfg.criteria, rules };
    expect(totalOf(d)).toBe(100);
    expect(isDirty(d, cfg)).toBe(false);
    expect(isDirty({ ...d, rules: { ...rules, min_events: 4 } }, cfg)).toBe(true);
    expect(totalOf(null)).toBe(0);
  });
  test("khôi phục: tiêu chí có sẵn vừa xoá + đã xoá trước, không trùng", () => {
    const d = { criteria: cfg.criteria.filter((c) => c.key !== "reminders"), rules };
    expect(restorableOf(d, cfg).map((r) => r.key)).toEqual(["reminders", "tenure"]);
  });
  test("tự chấm còn thêm được = danh sách trừ đã có", () => {
    expect(choicesOf({ criteria: cfg.criteria, rules }, cfg)).toEqual(["Thái độ hợp tác"]);
  });
  test("ô số chỉ chữ số, trần 100; lên/xuống mức", () => {
    expect([toInt("12a"), toInt("250"), toInt("")]).toEqual([12, 100, 0]);
    expect([wentUp("watch", "fair"), wentUp("good", "fair"), wentUp(null, "watch")]).toEqual([
      true,
      false,
      true,
    ]);
  });
});
