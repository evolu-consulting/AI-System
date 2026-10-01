// ADM-FR-55 · M3-R20 · diffFields: chỉ trường khác, khoá phẳng, bỏ khoá hệ thống, giới hạn dòng.
import { describe, expect, test } from "bun:test";
import { DIFF_MAX_ROWS, diffFields, formatDiffValue } from "./diff-fields";

describe("ADM-FR-55 · diffFields", () => {
  test("chỉ trả trường khác, khoá phẳng, giá trị chuỗi có nháy", () => {
    const mine = {
      description: { vi: "Dịch nhanh", en: "x" },
      args: [{ default: "en" }],
      name: "dich",
    };
    const latest = {
      description: { vi: "Dịch văn bản", en: "x" },
      args: [{ default: "vi" }],
      name: "dich",
    };
    const { rows, more } = diffFields(mine, latest);
    expect(rows.map((r) => r.path)).toEqual(["description.vi", "args[0].default"]);
    expect(rows[1]).toMatchObject({ mine: '"en"', latest: '"vi"' });
    expect(more).toBe(0);
  });

  test("bỏ khoá hệ thống cấp ngoài, giữ id lồng trong mảng", () => {
    const { rows } = diffFields(
      { id: "a", version: 1, updated_at: "x", command_ids: ["c1"] },
      { id: "b", version: 2, updated_at: "y", command_ids: ["c2"] },
    );
    expect(rows.map((r) => r.path)).toEqual(["command_ids[0]"]);
  });

  test("null và thiếu coi như bằng nhau; thiếu một bên → ô trống", () => {
    expect(diffFields({ a: null }, {}).rows).toEqual([]);
    const { rows } = diffFields({ a: "x" }, {});
    expect(rows[0]).toMatchObject({
      path: "a",
      mine: '"x"',
      latest: "",
      latestEmpty: true,
      mineEmpty: false,
    });
  });
});

describe("ADM-FR-55 · diffFields (biên)", () => {
  test("bằng nhau → rỗng; số/bool thô; mảng độ dài khác", () => {
    expect(diffFields({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual({ rows: [], more: 0 });
    const { rows } = diffFields({ n: 1, ok: true, l: [1, 2] }, { n: 2, ok: false, l: [1] });
    expect(rows.map((r) => [r.path, r.mine, r.latest])).toEqual([
      ["n", "1", "2"],
      ["ok", "true", "false"],
      ["l[1]", "2", ""],
    ]);
  });

  test("cắt ở 50 dòng và báo `more`", () => {
    const a: Record<string, number> = {};
    const b: Record<string, number> = {};
    for (let i = 0; i < 53; i++) {
      a[`k${i}`] = 1;
      b[`k${i}`] = 2;
    }
    const r = diffFields(a, b);
    expect(r.rows).toHaveLength(DIFF_MAX_ROWS);
    expect(r.more).toBe(3);
  });

  test("formatDiffValue", () => {
    expect(formatDiffValue(null)).toBe("");
    expect(formatDiffValue("en")).toBe('"en"');
    expect(formatDiffValue([])).toBe("[]");
    expect(formatDiffValue({})).toBe("{}");
  });
});
