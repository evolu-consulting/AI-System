import { describe, expect, it } from "bun:test";
import { requestSummary } from "./task-request-summary.rules";

const stage0 = {
  node: "core.start-form",
  start_form: {
    fields: [
      { key: "ncc", label: "Nhà cung cấp", type: "text", required: false },
      { key: "gia", label: "Giá", type: "money", required: false },
    ],
    starters: { kind: "everyone" },
    title_template: "Mua {{ncc}}",
  },
};
const inputs = [
  { key: "request_title", type: "text", text: "Mua máy in" },
  { key: "ncc", type: "text", text: "Công ty An Phát" },
  { key: "gia", type: "number", value: "1500000" },
];

describe("requestSummary", () => {
  it("lấy tên, đối tác (ô NCC) và số tiền (ô money)", () => {
    expect(requestSummary(stage0, inputs)).toEqual({
      title: "Mua máy in",
      partner: "Công ty An Phát",
      amount: "1500000",
    });
  });
  it("thiếu phần nào ⇒ null phần đó; lượt không có phiếu ⇒ lấy phiếu lượt cha", () => {
    expect(requestSummary(stage0, [inputs[0]]).amount).toBeNull();
    expect(requestSummary(null, [], stage0, inputs).amount).toBe("1500000");
    expect(requestSummary(null, [])).toEqual({ title: null, partner: null, amount: null });
  });
});
