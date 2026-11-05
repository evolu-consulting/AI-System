// CR-120 · FLOW-FR-03 · Cài đặt › Ứng dụng & quy trình đọc khe từ manifest.
import { describe, expect, test } from "bun:test";
import { paneSlots } from "./app-slots";

describe("FLOW-FR-03 · paneSlots", () => {
  test("community: 3 khe manifest hiện cả khi năng lực chưa có (present=false)", () => {
    expect(paneSlots("community", []).map((s) => [s.key, s.present])).toEqual([
      ["community.post-moderation", false],
      ["community.partner-join", false],
      ["community.report", false],
    ]);
  });

  test("contracts: khe manifest theo thứ tự + khe năng lực ngoài manifest đứng sau", () => {
    const r = paneSlots("contracts", [{ slot: "contracts.extra" }, { slot: "contracts.approval" }]);
    expect(r.map((s) => [s.key, s.decl !== null, s.present])).toEqual([
      ["contracts.approval", true, true],
      ["contracts.intake", true, false],
      ["contracts.extra", false, true],
    ]);
  });
});
