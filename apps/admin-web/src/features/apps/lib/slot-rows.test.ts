// CR-120 · FLOW-FR-03 · /apps tab Quy trình: khe theo manifest + khe hub ngoài manifest.
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts";
import { slotRows } from "./slot-rows";

describe("FLOW-FR-03 · slotRows", () => {
  test("mọi khe manifest có hàng (thiếu hub ⇒ view null), khe hub ngoài manifest đứng sau", () => {
    const views = [{ slot: { slot: "contracts.extra" } }, { slot: { slot: "contracts.approval" } }];
    const rows = slotRows(CONTRACTS_MANIFEST.slots, views);
    expect(rows.map((r) => [r.key, r.decl !== null, r.view !== null])).toEqual([
      ["contracts.approval", true, true],
      ["contracts.intake", true, false],
      ["contracts.extra", false, true],
    ]);
  });
});
