// dify-input-map · gợi ý/ánh xạ tham số workflow ⇒ trường HĐ (thuần).
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "../api-flow";
import {
  defaultMapping,
  difyInputIssues,
  effectiveField,
  fieldsFor,
  guessField,
  setMapping,
} from "./flow-dify-map";

const p = (name: string, type: string, required = true) => ({ name, type, required });

describe("flow-dify-map", () => {
  it("gợi ý: cùng tên, bí danh, tôn trọng kiểu; không rõ ⇒ không gợi ý", () => {
    expect(guessField(p("title", "text"))).toBe("title");
    expect(guessField(p("contract_value", "number"))).toBe("total_value");
    expect(guessField(p("contract_type", "text"))).toBe("deal");
    expect(guessField(p("doi_tac", "text"))).toBe("partner");
    expect(guessField(p("value", "text"))).toBe("total_value");
    expect(guessField(p("value", "select"))).toBeUndefined();
    expect(guessField(p("xyz", "text"))).toBeUndefined();
    expect(fieldsFor("number")).toEqual(["total_value"]);
  });
  it("mặc định khi thêm bước; hiệu lực = ánh xạ tường minh hoặc cùng tên; bỏ hết ⇒ undefined", () => {
    const inputs = [
      p("contract_value", "number"),
      p("contract_type", "text"),
      p("note", "text", false),
    ];
    expect(defaultMapping(inputs)).toEqual({
      contract_value: "total_value",
      contract_type: "deal",
    });
    expect(effectiveField({}, p("partner", "text"))).toBe("partner");
    expect(effectiveField({ inputs: { partner: "title" } }, p("partner", "text"))).toBe("title");
    expect(effectiveField({}, p("note", "text"))).toBeUndefined();
    expect(setMapping({ a: "title" }, "a", "")).toBeUndefined();
    expect(setMapping(undefined, "a", "deal")).toEqual({ a: "deal" });
  });
  it("tham số bắt buộc chưa ánh xạ ⇒ lỗi tại inputs.<tên>", () => {
    const wf = { key: "w", name: "w", inputs: [p("contract_value", "number"), p("x", "text")] };
    const step = (inputs?: Record<string, "total_value">) =>
      ({ kind: "dify", key: "d", name: "d", workflow_key: "w", inputs, after: "auto" }) as FlowStep;
    expect(difyInputIssues([step({ contract_value: "total_value" })], [wf])).toEqual([
      { index: 0, field: "inputs.x", code: "DIFY_PARAM_UNSUPPORTED" },
    ]);
    expect(difyInputIssues([step()], undefined)).toEqual([]);
  });
});
