// CR-127 · K7 · BR-55/56: schema trích xuất mở rộng — bản cũ vẫn hợp lệ; risks chỉ từ danh sách cố định; phạt dạng số strict.
import { describe, expect, it } from "bun:test";
import { ExtractionOutputSchema } from "@ai/contracts/pack-contracts";
import { parseExtraction } from "./extraction-agent";

const KEYS = Object.keys(ExtractionOutputSchema.shape.fields.shape);
const base = () => ({
  fields: Object.fromEntries(KEYS.map((k) => [k, { value: null, quote: "" }])),
  items: [],
  clauses: [],
});
const TERM = {
  party: "partner",
  trigger: "late_delivery",
  rate_pct: 0.5,
  basis: "per_day_of_value",
  cap_pct: 8,
  cap_amount: null,
  clause_ref: "Điều 7",
  page: 3,
  quote: "phạt 0,5%/ngày",
};

describe("K7 · schema AI notes/risks/penalty_terms", () => {
  it("bản cũ (không notes/risks/penalty_terms, mốc không clause_ref) ⇒ hợp lệ", () => {
    const old = {
      ...base(),
      milestones: [{ kind: "delivery", title: null, due_date: null, amount: null, quote: "" }],
    };
    expect(parseExtraction(JSON.stringify(old))).not.toBeNull();
  });
  it("đủ notes + risks + penalty_terms ⇒ parse", () => {
    const o = {
      ...base(),
      notes: [
        {
          group: "penalty",
          text: "Phạt chậm giao",
          clause_ref: "Điều 7",
          page: 3,
          party: "partner",
        },
      ],
      risks: [{ kind: "auto_renew", text: "Tự gia hạn" }],
      penalty_terms: [TERM],
    };
    const r = parseExtraction(JSON.stringify(o));
    expect(r?.penalty_terms?.[0]?.cap_pct).toBe(8);
  });
  it("risk ngoài danh sách cố định ⇒ từ chối", () => {
    const o = { ...base(), risks: [{ kind: "weird", text: "x" }] };
    expect(parseExtraction(JSON.stringify(o))).toBeNull();
  });
  it("phạt: tỷ lệ > 100 hoặc khoá lạ ⇒ từ chối", () => {
    expect(
      parseExtraction(JSON.stringify({ ...base(), penalty_terms: [{ ...TERM, rate_pct: 120 }] })),
    ).toBeNull();
    expect(
      parseExtraction(JSON.stringify({ ...base(), penalty_terms: [{ ...TERM, extra: 1 }] })),
    ).toBeNull();
  });
});
