import { describe, expect, test } from "bun:test";
import {
  appendRow,
  extractCrIds,
  formatRow,
  lastMigrations,
  lastShaForEnv,
  RELEASES_HEADER,
} from "./release-log.rules";

describe("release-log.rules", () => {
  test("lastMigrations lấy số lớn nhất mỗi thư mục", () => {
    const s = lastMigrations([
      "packages/db/migrations/0039_a.sql",
      "packages/db/migrations/0040_b.sql",
      "packages/db/migrations/meta/_journal.json",
      "packages/db/migrations-hub/0130_x.sql",
      "packages/db/migrations-pack-contracts/0007_c.sql",
      "packages/db/migrations-pack-community/0003_n.sql",
    ]);
    expect(s).toBe("admin 0040 · hub 0130 · community:0003 contracts:0007");
  });

  test("extractCrIds duy nhất, giữ thứ tự", () => {
    expect(extractCrIds(["[CR-126] a", "x CR-125 và CR-126", "không có"])).toEqual([
      "CR-126",
      "CR-125",
    ]);
  });

  test("formatRow, appendRow, lastShaForEnv", () => {
    const row = formatRow({
      date: "2026-11-10",
      env: "staging",
      sha: "2cc1b296e",
      migrations: "admin 0040",
      crs: [],
      by: "a|b",
    });
    expect(row).toBe("| 2026-11-10 | staging | 2cc1b296e | admin 0040 | - | a/b |");
    const md = appendRow("", row);
    expect(md.startsWith(RELEASES_HEADER)).toBe(true);
    expect(lastShaForEnv(md, "staging")).toBe("2cc1b296e");
    expect(lastShaForEnv(md, "prod")).toBeNull();
    expect(
      appendRow(md, row)
        .split("\n")
        .filter((l) => l.includes("2cc1b296e")).length,
    ).toBe(2);
  });
});
