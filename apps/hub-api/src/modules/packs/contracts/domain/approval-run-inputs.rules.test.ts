// CR-121 F-5 · input run lấy từ HĐ: chỉ khi quy trình có bước đọc input HĐ; có Thông báo/Chờ tới ⇒ thêm số HĐ, người phụ trách, ngày.
import { describe, expect, it } from "bun:test";
import type { FlowStep } from "./approval-flow.types";
import { contractRunInputs, usesContractInputs } from "./approval-run-inputs.rules";

const review = { kind: "review", key: "a" } as unknown as FlowStep;
const notify = { kind: "notify", key: "n" } as unknown as FlowStep;
const F = {
  title: "Mua máy chủ",
  deal: "buy",
  totalValue: 100,
  partner: "ACME",
  number: "HD-09",
  owner: null,
  endDate: "2026-12-01",
};

describe("CR-121 F-5 · contractRunInputs", () => {
  it("quy trình chỉ có bước duyệt ⇒ không input HĐ", () => {
    expect(usesContractInputs([review])).toBe(false);
    expect(contractRunInputs([review], F)).toEqual([]);
  });
  it("có Thông báo ⇒ tiêu đề + số HĐ đã xác nhận + ngày", () => {
    const keys = contractRunInputs([review, notify], F).map((i) => i.key);
    expect(keys).toContain("contract-title");
    expect(keys).toContain("contract-value");
    expect(keys).toContain("contract-number");
    expect(keys).toContain("contract-end-date");
    expect(keys).not.toContain("contract-owner");
  });
});
