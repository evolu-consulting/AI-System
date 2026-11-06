import { describe, expect, test } from "bun:test";
import { slotsOfCaps } from "./caps-slots";

const slot = (s: string) => ({
  slot: s,
  def_id: null,
  def_name: null,
  version: null,
  is_default: true,
});

describe("slotsOfCaps", () => {
  test("gom khe các app kèm app chủ, bỏ trùng, theo tên", () => {
    const apps = [
      { key: "community", slots: [slot("community.x")] },
      { key: "contracts", slots: [slot("contracts.approval"), slot("contracts.approval")] },
    ];
    expect(slotsOfCaps({ apps } as never)).toEqual([
      { slot: "community.x", app: "community" },
      { slot: "contracts.approval", app: "contracts" },
    ]);
  });
});
