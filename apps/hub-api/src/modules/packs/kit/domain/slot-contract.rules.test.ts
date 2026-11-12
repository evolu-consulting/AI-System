// CR-120 · FLOW-FR-01 · kiểm khe manifest ↔ SlotSpec/FlowSlotAdapter lúc mount.
import { describe, expect, test } from "bun:test";
import { CONTRACTS_MANIFEST } from "@ai/contracts/app-manifest";
import { slotContractGaps } from "./slot-contract.rules";

describe("FLOW-FR-01 · slotContractGaps", () => {
  test("khe manifest thiếu SlotSpec ⇒ gap spec, runtime bật mà thiếu adapter ⇒ gap adapter", () => {
    expect(
      slotContractGaps([CONTRACTS_MANIFEST], new Set(["contracts.intake"]), new Set()),
    ).toEqual([{ app: "contracts", slot: "contracts.intake", missing: "adapter" }]);
    expect(slotContractGaps([CONTRACTS_MANIFEST], new Set(), new Set())).toEqual([
      { app: "contracts", slot: "contracts.intake", missing: "spec" },
      { app: "contracts", slot: "contracts.intake", missing: "adapter" },
    ]);
  });

  test("runtime tắt ⇒ không kiểm adapter; đủ spec ⇒ rỗng", () => {
    const all = new Set(CONTRACTS_MANIFEST.slots.map((s) => s.key));
    expect(slotContractGaps([CONTRACTS_MANIFEST], all, null)).toEqual([]);
  });
});
