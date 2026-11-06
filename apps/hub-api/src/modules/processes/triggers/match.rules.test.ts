// CR-122 · E1 · FLOW2-FR-03/20 · luật thuần chọn flow: điều kiện trên dữ kiện, decides chỉ flow đầu, thử lại có lùi.
import { describe, expect, test } from "bun:test";
import type { FactWhen } from "@ai/contracts/hub-admin";
import { type FlowCandidate, planEvent, retryDelayMs, whenHolds } from "./match.rules";

const c = (id: string, when: FactWhen | null = null): FlowCandidate => ({
  companyFlowId: id,
  flowId: `f-${id}`,
  defKey: id,
  position: 0,
  when,
});
const big: FactWhen = { op: "and", conds: [{ fact: "total_value", op: "ge", value: 1000 }] };

describe("CR-122 E1 · whenHolds", () => {
  test("không điều kiện ⇒ khớp; trường trống ⇒ không khớp", () => {
    expect(whenHolds(null, {})).toBe(true);
    expect(whenHolds(big, {})).toBe(false);
    expect(whenHolds(big, { total_value: null })).toBe(false);
  });
  test("so sánh số, in (giá trị đơn và mảng phòng ban), eq boolean, ne", () => {
    expect(whenHolds(big, { total_value: 1000 })).toBe(true);
    expect(whenHolds(big, { total_value: 999 })).toBe(false);
    const w: FactWhen = {
      op: "and",
      conds: [
        { fact: "deal", op: "in", value: ["buy", "sell"] },
        { fact: "creator_department", op: "in", value: ["kinh-doanh"] },
        { fact: "new_partner", op: "eq", value: true },
        { fact: "file_type", op: "ne", value: "pdf" },
      ],
    };
    const ok = {
      deal: "buy",
      creator_department: ["ban-gd", "kinh-doanh"],
      new_partner: true,
      file_type: "docx",
    };
    expect(whenHolds(w, ok)).toBe(true);
    expect(whenHolds(w, { ...ok, creator_department: ["ban-gd"] })).toBe(false);
    expect(whenHolds(w, { ...ok, new_partner: false })).toBe(false);
  });
  test("OR ngoài, AND lồng một cấp; kiểu lệch (chuỗi so số) ⇒ không khớp", () => {
    const w: FactWhen = {
      op: "or",
      conds: [
        { fact: "deal", op: "eq", value: "referral" },
        {
          op: "and",
          conds: [
            { fact: "total_value", op: "gt", value: 10 },
            { fact: "total_value", op: "lt", value: 20 },
          ],
        },
      ],
    };
    expect(whenHolds(w, { deal: "referral" })).toBe(true);
    expect(whenHolds(w, { total_value: 15 })).toBe(true);
    expect(whenHolds(w, { total_value: 25 })).toBe(false);
    expect(whenHolds(w, { total_value: "15" })).toBe(false);
  });
});

describe("CR-122 E1 · planEvent", () => {
  test("không decides ⇒ mọi flow khớp chạy; không khớp ghi not_matched", () => {
    const p = planEvent([c("a", big), c("b"), c("d")], { total_value: 1 }, false);
    expect(p.run.map((x) => x.companyFlowId)).toEqual(["b", "d"]);
    expect(p.skipped).toEqual([{ companyFlowId: "a", reason: "not_matched" }]);
  });
  test("decides ⇒ chỉ flow khớp đầu; flow sau ghi decided_by_earlier", () => {
    const p = planEvent([c("a", big), c("b"), c("d")], { total_value: 5000 }, true);
    expect(p.run.map((x) => x.companyFlowId)).toEqual(["a"]);
    expect(p.skipped).toEqual([
      { companyFlowId: "b", reason: "decided_by_earlier", by: "a" },
      { companyFlowId: "d", reason: "decided_by_earlier", by: "a" },
    ]);
  });
  test("không ứng viên ⇒ kế hoạch rỗng", () => {
    expect(planEvent([], {}, true)).toEqual({ run: [], skipped: [] });
  });
});

describe("CR-122 E1 · retryDelayMs", () => {
  test("30 s, 60 s, 120 s … trần 30 phút", () => {
    expect([1, 2, 3].map(retryDelayMs)).toEqual([30_000, 60_000, 120_000]);
    expect(retryDelayMs(20)).toBe(30 * 60_000);
  });
});
