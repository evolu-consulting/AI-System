// CR-120 · cr120-review-fixes · khe opt-in (3 khe Community) KHÔNG được cấp mặc định và không bị đòi "có quy trình hiển thị".
import { describe, expect, it } from "bun:test";
import { coverageSlotsOf } from "../ops/adapters/checks/flow-coverage.check";
import { communitySlotSpecs } from "../packs/community/domain/flow-slots.rules";
import { defaultSlotsOf } from "./library/slot-defaults";

const list = () => [
  { key: "contracts.approval", packKey: "contracts" },
  { key: "dlc.x", packKey: "dlc" },
  ...communitySlotSpecs(),
];

describe("khe opt-in", () => {
  it("defaultSlotsOf: bỏ dlc.* và khe Community (opt-in), giữ khe thường", () => {
    expect(defaultSlotsOf(list).map((s) => s.slot)).toEqual(["contracts.approval"]);
  });
  it("coverageSlotsOf: khe opt-in không bị kiểm 'có quy trình hiển thị'", () => {
    expect(coverageSlotsOf(list).map((s) => s.slot)).toEqual(["contracts.approval"]);
  });
  it("cả 3 khe Community đều đánh dấu opt-in", () => {
    expect(communitySlotSpecs().every((s) => s.optIn === true)).toBe(true);
  });
});
