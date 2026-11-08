// CR-125 · cr125-manual-start-ui · `requestFields`: giá trị phiếu đã ghi ở `process_runs.inputs` ⇒ danh sách ô có nhãn theo phiếu (ô trống bỏ).
import { describe, expect, test } from "bun:test";
import { requestFields } from "./manual-request.service";

const cfg = {
  fields: [
    { key: "item", label: "Tên hàng", type: "text", required: true },
    { key: "price", label: "Giá dự kiến", type: "money", required: false },
    { key: "note", label: "Lý do", type: "longtext", required: false },
  ],
  starters: { kind: "everyone" },
  title_template: "Mua {{item}}",
} as never;

describe("requestFields", () => {
  test("nhãn theo phiếu, tiền lấy từ value, ô vắng bỏ", () => {
    const inputs = [
      { key: "item", type: "text", text: "Máy in" },
      { key: "price", type: "number", value: "12500000" },
      { key: "request_title", type: "text", text: "Mua Máy in" },
    ];
    expect(requestFields(cfg, inputs)).toEqual([
      { key: "item", label: "Tên hàng", type: "text", value: "Máy in" },
      { key: "price", label: "Giá dự kiến", type: "money", value: "12500000" },
    ]);
    expect(requestFields(cfg, null)).toEqual([]);
  });
});
