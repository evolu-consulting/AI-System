// CR-122 · khoá input `contract-id` (mẫu/flow cũ) ⇄ `contract_id` (lượt mở từ sự kiện) là một.
import { describe, expect, it } from "bun:test";
import { buildToolArgs, inputKeyOf } from "./tool-run.rules";

describe("CR-122 · khoá input coi - và _ là một", () => {
  it("đúng khoá thắng; vắng ⇒ thử dạng còn lại; không có ⇒ undefined", () => {
    const both = new Map([
      ["contract-id", "a"],
      ["contract_id", "b"],
    ]);
    expect(inputKeyOf("contract-id", both)).toBe("contract-id");
    expect(inputKeyOf("contract-id", new Map([["contract_id", "b"]]))).toBe("contract_id");
    expect(inputKeyOf("contract_id", new Map([["contract-id", "a"]]))).toBe("contract-id");
    expect(inputKeyOf("x-y", new Map([["z", "1"]]))).toBeUndefined();
  });
  it("bước Ký số khai contract-id, lượt từ sự kiện mang contract_id ⇒ dựng được tham số", () => {
    const built = buildToolArgs(
      { contract_id: { from: "input", key: "contract-id" } },
      new Map([["contract_id", "c-1"]]),
      new Map(),
    );
    expect(built).toEqual({ ok: true, values: { contract_id: "c-1" } });
  });
});
