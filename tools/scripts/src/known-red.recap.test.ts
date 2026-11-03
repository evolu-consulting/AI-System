// known-red · gán đúng file cho ca đỏ int: log `bun test` thật (evotest 2026-11-03, 4 đỏ) có khối tóm tắt "N tests failed:" lặp lại
// các (fail) KHÔNG kèm tiêu đề file — trước đây bị gán nhầm vào file cuối (seed-community-demo) ⇒ quarantine theo file trượt.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  hasFile,
  intReds,
  type KnownRed,
  matchesEntry,
  parseKnownRed,
  splitReds,
} from "./known-red.rules";

const fixture = readFileSync(resolve(import.meta.dir, "__fixtures__/int-recap.txt"), "utf8");
const entries = parseKnownRed(
  readFileSync(resolve(import.meta.dir, "../../../tests/known-red.json"), "utf8"),
);
const TODAY = "2026-11-03";

describe("known-red · intReds gán đúng file (log thật)", () => {
  const reds = intReds(fixture);
  const files = reds.map((r) => r.name.split(" › ")[0]);

  it("đúng 4 đỏ, mỗi ca gắn file của chính nó (khối tóm tắt cuối không đẻ thêm / không gán nhầm)", () => {
    expect(reds).toHaveLength(4);
    expect(files).toEqual([
      "apps/hub-api/src/modules/chat-gate/chat-gate.int.test.ts",
      "packages/db/src/hub-rls.int.test.ts",
      "packages/db/src/migrate-hub.int.test.ts",
      "packages/db/src/migrate-hub.int.test.ts",
    ]);
    expect(reds[0]?.name).toBe(
      "apps/hub-api/src/modules/chat-gate/chat-gate.int.test.ts › (unnamed)",
    );
    expect(reds.some((r) => r.name.startsWith("tools/scripts/src/seed-community-demo"))).toBe(
      false,
    );
  });

  it("known-red thật: (unnamed) chat-gate + 2 migrate-hub ⇒ known; hub-rls (chưa ghi) ⇒ đỏ MỚI duy nhất", () => {
    const s = splitReds(reds, entries, TODAY);
    expect(s.known.map((h) => h.red.name.split(" › ")[0])).toEqual([
      "apps/hub-api/src/modules/chat-gate/chat-gate.int.test.ts",
      "packages/db/src/migrate-hub.int.test.ts",
      "packages/db/src/migrate-hub.int.test.ts",
    ]);
    expect(s.fresh.map((r) => r.name.split(" › ")[0])).toEqual([
      "packages/db/src/hub-rls.int.test.ts",
    ]);
    expect(s.expired).toEqual([]);
  });

  it("chỉ có khối tóm tắt (log cắt mất phần inline): ca không có file, vẫn khớp theo tên ca; không đếm đôi khi đã có inline", () => {
    const recapOnly = fixture.slice(fixture.indexOf("4 tests failed:"));
    const r = intReds(recapOnly);
    expect(r).toHaveLength(4);
    expect(r.every((x) => !hasFile(x.name))).toBe(true);
    const s = splitReds(r, entries, TODAY);
    // 2 migrate-hub khớp theo tên ca; "(unnamed)" chỉ có id mức file ⇒ không dự phòng được (đỏ mới, đúng thận trọng); hub-rls mới.
    expect(s.known).toHaveLength(2);
    expect(s.fresh).toHaveLength(2);
  });
});

describe("known-red · matchesEntry (file, tên) + dự phòng theo tên", () => {
  const e: KnownRed = {
    id: "packages/db/src/x.int.test.ts › Mô tả > ca A",
    suite: "int",
    reason: "r",
    owner: "o",
    expires: "2026-11-17",
    since: "2026-11-03",
  };

  it("có file ⇒ phải đúng file; file khác cùng tên ca KHÔNG khớp", () => {
    expect(
      matchesEntry({ suite: "int", name: "packages/db/src/x.int.test.ts › Mô tả > ca A" }, e),
    ).toBe(true);
    expect(
      matchesEntry({ suite: "int", name: "tools/scripts/src/y.int.test.ts › Mô tả > ca A" }, e),
    ).toBe(false);
  });

  it("không có file ⇒ khớp theo tên ca; tên khác thì không", () => {
    expect(matchesEntry({ suite: "int", name: "Mô tả > ca A" }, e)).toBe(true);
    expect(matchesEntry({ suite: "int", name: "Mô tả > ca B" }, e)).toBe(false);
    expect(hasFile("a/b.int.test.ts › x")).toBe(true);
    expect(hasFile("Mô tả > ca A")).toBe(false);
  });

  it("id chỉ có file (không phần ca) không dự phòng được cho đỏ không file", () => {
    const fileOnly = { ...e, id: "packages/db/src/x.int.test.ts" };
    expect(matchesEntry({ suite: "int", name: "(unnamed)" }, fileOnly)).toBe(false);
    expect(
      matchesEntry({ suite: "int", name: "packages/db/src/x.int.test.ts › (unnamed)" }, fileOnly),
    ).toBe(true);
  });
});
