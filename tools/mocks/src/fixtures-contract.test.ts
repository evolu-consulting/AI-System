// CR-127 · K7: fixture AI "phạt + Điều cần lưu ý" hợp lệ theo schema trích xuất (strict).
import { describe, expect, it } from "bun:test";
import { ExtractionOutputSchema } from "@ai/contracts/pack-contracts";
import { CONTRACT_EXTRACT_PENALTY_FIXTURE } from "./fixtures";

describe("CR-127 K7 · fixture mock AI", () => {
  it("parse strict được và có phạt dạng số + notes + risks", () => {
    const fields = Object.fromEntries(
      Object.keys(ExtractionOutputSchema.shape.fields.shape).map((k) => [
        k,
        { value: null, quote: "" },
      ]),
    );
    const p = ExtractionOutputSchema.parse({ ...CONTRACT_EXTRACT_PENALTY_FIXTURE, fields });
    expect(p.penalty_terms?.[0]?.rate_pct).toBe(0.5);
    expect(p.notes?.length).toBe(2);
    expect(p.risks?.[0]?.kind).toBe("one_sided_penalty");
  });
});
