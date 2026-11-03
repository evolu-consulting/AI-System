// test:affected --run server: chia thùng theo slot trống, ghép lệnh evotest, đọc số slot từ res:check.
import { describe, expect, it } from "bun:test";
import {
  chunkEven,
  e2eCost,
  evotestArgs,
  freeSlotsOf,
  mergeCmds,
  serverBins,
} from "./test-affected.server.rules";

const CONFIGS = [
  "playwright.config.ts",
  "e2e/N1/playwright.config.ts",
  "e2e/studio/playwright.config.ts",
];
const ints = Array.from({ length: 24 }, (_, i) => `tests/acceptance/A/f${i}.int.test.ts`);

describe("test:affected · chia thùng server", () => {
  it("chunkEven xen kẽ, không quá n nhóm, không nhóm rỗng", () => {
    expect(chunkEven([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 3, 5],
      [2, 4],
    ]);
    expect(chunkEven([1], 4)).toEqual([[1]]);
    expect(chunkEven([], 3)).toEqual([]);
  });

  it("e2eCost: root = ca gốc (613), việc lạ = 60", () => {
    expect(e2eCost("root", CONFIGS)).toBe(613);
    expect(e2eCost("N1", CONFIGS)).toBe(21);
    expect(e2eCost("zzz", CONFIGS)).toBe(60);
  });

  it("không có slot (0) ⇒ vẫn 1 thùng, int gộp một lệnh + e2e gộp bằng dấu phẩy", () => {
    const bins = serverBins(ints.slice(0, 3), ["root", "N1"], CONFIGS, 0);
    expect(bins).toHaveLength(1);
    expect(bins[0]?.cmds).toEqual([
      { step: "int", filter: ints.slice(0, 3).join(" ") },
      { step: "e2e", filter: "root,N1" },
    ]);
  });

  it("nhiều slot: việc nặng (root) một thùng riêng, int chia lô; mọi file/việc xuất hiện đúng một lần", () => {
    const bins = serverBins(ints, ["root", "N1", "studio"], CONFIGS, 3);
    expect(bins.length).toBeLessThanOrEqual(3);
    const e2e = bins.flatMap((b) =>
      b.cmds.filter((c) => c.step === "e2e").flatMap((c) => c.filter.split(",")),
    );
    expect(e2e.sort()).toEqual(["N1", "root", "studio"]);
    const files = bins.flatMap((b) =>
      b.cmds.filter((c) => c.step === "int").flatMap((c) => c.filter.split(" ")),
    );
    expect(files.sort()).toEqual([...ints].sort());
    const rootBin = bins.find((b) =>
      b.cmds.some((c) => c.step === "e2e" && c.filter.split(",").includes("root")),
    );
    expect(rootBin?.cmds.some((c) => c.step === "e2e" && c.filter.includes("N1"))).toBe(false);
  });

  it("kế hoạch rỗng ⇒ không thùng; mergeCmds giữ thứ tự int trước e2e", () => {
    expect(serverBins([], [], CONFIGS, 4)).toEqual([]);
    expect(
      mergeCmds([
        { step: "e2e", filter: "a" },
        { step: "int", filter: "x" },
        { step: "e2e", filter: "b" },
      ]),
    ).toEqual([
      { step: "int", filter: "x" },
      { step: "e2e", filter: "a,b" },
    ]);
  });

  it("evotestArgs: -Step/-Filter, -Dirty và -All chỉ khi bật", () => {
    expect(evotestArgs({ step: "e2e", filter: "root,N1" }, false)).toEqual([
      "-NoProfile",
      "-File",
      "deploy/evotest/run-tests.ps1",
      "-Step",
      "e2e",
      "-Filter",
      "root,N1",
    ]);
    expect(evotestArgs({ step: "int", filter: "a b" }, true, true).slice(-2)).toEqual([
      "-Dirty",
      "-All",
    ]);
  });

  it("freeSlotsOf: ưu tiên khuyến nghị, rồi đếm slot rảnh; không đo được ⇒ null", () => {
    expect(freeSlotsOf({ recommendation: { serverSlots: 2 } })).toBe(2);
    expect(
      freeSlotsOf({
        recommendation: { serverSlots: null },
        server: { slotsBusy: [true, false, false] },
      }),
    ).toBe(2);
    expect(freeSlotsOf({ recommendation: { serverSlots: null }, server: null })).toBeNull();
    expect(freeSlotsOf(null)).toBeNull();
  });
});
