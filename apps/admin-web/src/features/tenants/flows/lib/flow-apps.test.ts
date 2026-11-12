// CR-130 · ADR-0044 · app chọn được khi tạo quy trình: Bảng tin theo add-on của gói contracts, không theo gói `community`.
import { describe, expect, test } from "bun:test";
import { flowAppsOf } from "./flow-apps";

const ALL = ["contracts", "community", "knowledge"];
const set = (...k: string[]) => new Set(k);

describe("flowAppsOf", () => {
  test("gói contracts + add-on Bảng tin ⇒ có Sổ Hợp Tác và Bảng tin", () => {
    expect(flowAppsOf(ALL, set("contracts"), set("contracts-community"))).toEqual([
      "contracts",
      "community",
    ]);
  });
  test("chưa bật add-on ⇒ chỉ Sổ Hợp Tác (không có lựa chọn Bảng tin)", () => {
    expect(flowAppsOf(ALL, set("contracts"), set())).toEqual(["contracts"]);
  });
  test("add-on bật nhưng gói contracts tắt ⇒ không có Bảng tin", () => {
    expect(flowAppsOf(ALL, set(), set("contracts-community"))).toEqual([]);
  });
  test("gói khác vẫn theo gói bật", () => {
    expect(flowAppsOf(ALL, set("knowledge"), set())).toEqual(["knowledge"]);
  });
});
