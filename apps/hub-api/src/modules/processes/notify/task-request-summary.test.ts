import { describe, expect, it } from "bun:test";
import { requestSummary } from "./task-request-summary";

const stage0 = {
  node: "core.start-form",
  start_form: {
    fields: [
      { key: "ncc", label: "NhÃ  cung cáº¥p", type: "text", required: false },
      { key: "gia", label: "GiÃ¡", type: "money", required: false },
    ],
    starters: { kind: "everyone" },
    title_template: "Mua {{ncc}}",
  },
};
const inputs = [
  { key: "request_title", type: "text", text: "Mua mÃ¡y in" },
  { key: "ncc", type: "text", text: "CÃ´ng ty An PhÃ¡t" },
  { key: "gia", type: "number", value: "1500000" },
];

describe("requestSummary", () => {
  it("láº¥y tÃªn, Ä‘á»‘i tÃ¡c (Ã´ NCC) vÃ  sá»‘ tiá»n (Ã´ money)", () => {
    expect(requestSummary(stage0, inputs)).toEqual({
      title: "Mua mÃ¡y in",
      partner: "CÃ´ng ty An PhÃ¡t",
      amount: "1500000",
    });
  });
  it("thiáº¿u pháº§n nÃ o â‡’ null pháº§n Ä‘Ã³; lÆ°á»£t khÃ´ng cÃ³ phiáº¿u â‡’ láº¥y phiáº¿u lÆ°á»£t cha", () => {
    expect(requestSummary(stage0, [inputs[0]]).amount).toBeNull();
    expect(requestSummary(null, [], stage0, inputs).amount).toBe("1500000");
    expect(requestSummary(null, [])).toEqual({ title: null, partner: null, amount: null });
  });
});
