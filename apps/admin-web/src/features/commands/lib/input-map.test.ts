// ADM-FR-20, ADM-FR-22 · AC-A03 · M2-R16, R17 · reconcileMap / validateInputMap / mapWarnings / buildSyntax.
import { describe, expect, test } from "bun:test";
import { hasSource, type MapInput, mapWarnings, reconcileMap, validateInputMap } from "./input-map";
import { buildSyntax, mapSyntax } from "./syntax";

const inputs: MapInput[] = [
  { name: "source_text", type: "text", required: true },
  { name: "target_lang", type: "text", required: true },
  { name: "tone", type: "select", required: false, options: ["formal", "casual"] },
];
const sel = { source: "selection", value: "" } as const;

describe("AC-A03 · validateInputMap", () => {
  test("input bắt buộc chưa có nguồn → missing theo thứ tự schema", () => {
    const r = validateInputMap(inputs, [], {
      source_text: sel,
      target_lang: { source: "", value: "" },
    });
    expect(r.missing).toEqual(["target_lang"]);
  });

  test("arg chưa chọn tham số tính là thiếu; trỏ tham số lạ → unknownArgs", () => {
    const r = validateInputMap(inputs, [{ name: "lang" }], {
      source_text: { source: "arg", value: "" },
      target_lang: { source: "arg", value: "ngon-ngu" },
    });
    expect(r.missing).toEqual(["source_text"]);
    expect(r.unknownArgs).toEqual(["ngon-ngu"]);
  });

  test("đủ nguồn → không thiếu", () => {
    const r = validateInputMap(inputs, [], {
      source_text: sel,
      target_lang: { source: "const", value: "vi" },
    });
    expect(r.missing).toEqual([]);
    expect(r.unknownArgs).toEqual([]);
  });
});

describe("M2-R17 · mapWarnings (không chặn)", () => {
  test("file ← nguồn khác attachment; attachment → input không phải file", () => {
    const file: MapInput = { name: "f", type: "file", required: true };
    expect(mapWarnings([file], { f: sel })[0]).toMatchObject({ var: "f", reason: "type_mismatch" });
    expect(mapWarnings([file], { f: { source: "attachment", value: "" } })).toEqual([]);
    expect(
      mapWarnings([inputs[0] as MapInput], { source_text: { source: "attachment", value: "" } }),
    ).toHaveLength(1);
  });

  test("number/boolean/select ← nguồn văn bản; const sai dạng", () => {
    const n: MapInput = { name: "n", type: "number", required: false };
    expect(mapWarnings([n], { n: sel })).toHaveLength(1);
    expect(mapWarnings([n], { n: { source: "const", value: "abc" } })[0]?.reason).toBe(
      "const_invalid",
    );
    expect(mapWarnings([n], { n: { source: "const", value: "12" } })).toEqual([]);
    const tone = inputs[2] as MapInput;
    expect(mapWarnings([tone], { tone: { source: "const", value: "x" } })[0]?.reason).toBe(
      "const_invalid",
    );
    expect(mapWarnings([tone], { tone: { source: "const", value: "formal" } })).toEqual([]);
  });

  test("arg không bao giờ cảnh báo", () => {
    const n: MapInput = { name: "n", type: "number", required: false };
    expect(mapWarnings([n], { n: { source: "arg", value: "k" } })).toEqual([]);
  });
});

describe("ADM-FR-20 · reconcileMap", () => {
  test("giữ mục còn hợp lệ, liệt kê mục bị bỏ, tự map theo tên tham số", () => {
    const prev = {
      source_text: sel,
      target_lang: { source: "arg", value: "target_lang" },
      old_var: { source: "const", value: "x" },
    } as const;
    const next: MapInput[] = [
      { name: "source_text", type: "text", required: true },
      { name: "extra", type: "text", required: false },
    ];
    const r = reconcileMap({ ...prev }, next, [{ name: "extra" }]);
    expect(r.map.source_text).toEqual(sel);
    expect(r.map.extra).toEqual({ source: "arg", value: "extra" });
    expect(r.dropped).toEqual(["target_lang", "old_var"]);
    expect(r.autoMapped).toEqual(["extra"]);
  });

  test("arg trỏ tham số đã bị xoá thì bỏ map", () => {
    const r = reconcileMap(
      { source_text: { source: "arg", value: "gone" } },
      inputs.slice(0, 1),
      [],
    );
    expect(r.map.source_text).toEqual({ source: "", value: "" });
    expect(r.dropped).toEqual(["source_text"]);
  });

  test("hasSource", () => {
    expect(hasSource(undefined)).toBe(false);
    expect(hasSource({ source: "arg", value: "" })).toBe(false);
    expect(hasSource({ source: "const", value: "" })).toBe(true);
  });
});

describe("ADM-FR-20 · buildSyntax", () => {
  test("tham số có mặc định, bình thường và nuốt phần còn lại", () => {
    expect(
      buildSyntax("dich", [
        { name: "lang", default: "vi", rest: false },
        { name: "text", default: "", rest: true },
      ]),
    ).toBe("/dich <lang = vi> <text…>");
    expect(buildSyntax("tom-tat", [])).toBe("/tom-tat");
    expect(
      buildSyntax("x", [
        { name: "a", default: " ", rest: false },
        { name: "", default: "", rest: false },
      ]),
    ).toBe("/x <a>");
  });
});

describe("ADM-FR-21 · mapSyntax", () => {
  test("cú pháp từng nguồn", () => {
    expect(mapSyntax({ source: "arg", value: "lang" })).toBe("$args.lang");
    expect(mapSyntax({ source: "arg", value: "" })).toBe("");
    expect(mapSyntax({ source: "page_url", value: "" })).toBe("$page.url");
    expect(mapSyntax({ source: "const", value: "vi" })).toBe('"vi"');
    expect(mapSyntax({ source: "", value: "" })).toBe("");
  });
});
