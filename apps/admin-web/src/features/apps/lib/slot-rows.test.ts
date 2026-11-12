// CR-120 · FLOW-FR-03 · /apps tab Quy trình: khe theo manifest + khe hub ngoài manifest.
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { slotRows } from "./slot-rows";

describe("FLOW-FR-03 · slotRows", () => {
  test("mọi khe manifest có hàng (thiếu hub ⇒ view null), khe hub ngoài manifest đứng sau", () => {
    const views = [{ slot: { slot: "contracts.extra" } }, { slot: { slot: "contracts.intake" } }];
    const rows = slotRows(CONTRACTS_MANIFEST.slots, views);
    expect(rows.map((r) => [r.key, r.decl !== null, r.view !== null])).toEqual([
      ["contracts.intake", true, true],
      ["contracts.extra", false, true],
    ]);
    // thiếu view hub ⇒ view null
    expect(slotRows(CONTRACTS_MANIFEST.slots, []).map((r) => [r.key, r.view !== null])).toEqual([
      ["contracts.intake", false],
    ]);
  });
});
