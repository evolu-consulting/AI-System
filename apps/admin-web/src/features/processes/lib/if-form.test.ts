// CR-103 · fnr-if: helper thuần của khối "Nếu" — nguồn chọn được, đổi bản nháp ⇄ contract (bước đếm từ 1).
import { describe, expect, it } from "bun:test";
import { IfExecutorSchema } from "@ai/contracts/hub-admin";
import {
  condSources,
  draftToIf,
  emptyCond,
  emptyIf,
  ifErrorAt,
  ifToDraft,
  parseSrc,
} from "./if-form";

const stages = [
  { key: "a", step: 0, fields: [{ key: "tong", type: "number" as const, required: true }] },
  { key: "b", step: 1, fields: [{ key: "x", type: "string" as const, required: true }] },
];
const srcs = condSources(stages, [{ key: "muc", type: "select" }], 1);

describe("if-form", () => {
  it("nguồn: chỉ stage ở bước nhỏ hơn + input", () => {
    expect(srcs.map((s) => [s.value, s.type])).toEqual([
      ["field|a|tong", "number"],
      ["input|muc", "string"],
    ]);
  });
  it("parseSrc", () => {
    expect(parseSrc("field|a|tong")).toEqual({ kind: "field", stage_key: "a", field: "tong" });
    expect(parseSrc("input|muc")).toEqual({ kind: "input", key: "muc" });
    expect(parseSrc("")).toBeNull();
  });
  it("draft ⇄ contract: số ép number, bước trừ 1, else null giữ nguyên", () => {
    const d = {
      op: "or" as const,
      conds: [{ from: "field|a|tong", type: "number" as const, op: "gt", value: "100" }],
      yes: 4,
      no: null,
    };
    const e = draftToIf(d);
    expect(IfExecutorSchema.safeParse(e).success).toBe(true);
    expect(e.when.conds[0]?.value).toBe(100);
    expect(e.then_step).toBe(3);
    expect(ifToDraft(e)).toEqual(d);
  });
  it("bản nháp rỗng không qua schema (đích, nguồn chưa chọn)", () => {
    expect(IfExecutorSchema.safeParse(draftToIf(emptyIf())).success).toBe(false);
    expect(emptyCond().op).toBe("eq");
  });
  it("ifErrorAt theo path server", () => {
    const er = { "stages.2.executor.then_step": "k1", "stages.2.executor": "k2" };
    expect(ifErrorAt(er, 2, "then_step")).toBe("k1");
    expect(ifErrorAt(er, 2)).toBe("k2");
  });
});
