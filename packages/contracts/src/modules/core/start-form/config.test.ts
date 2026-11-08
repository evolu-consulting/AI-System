// CR-125 · cr125-manual-start-engine · luật thuần của phiếu yêu cầu: zod theo cấu hình, đầu ra = ô phiếu, input lượt, tên yêu cầu,
// nhóm cần cho templateReadiness.
import { describe, expect, test } from "bun:test";
import { MODULES } from "../../index.generated";
import { templateNeeds } from "../../template-readiness";
import {
  renderStartTitle,
  StartFormConfigSchema,
  startFormGroupKeys,
  startFormOutputs,
  startFormRunInputs,
  startFormValuesSchema,
} from "./config";

const CFG = StartFormConfigSchema.parse({
  fields: [
    { key: "item", label: "Hàng", type: "text", required: true },
    { key: "amount", label: "Số tiền", type: "money", required: true },
    { key: "people", label: "Người dùng", type: "people" },
    { key: "files", label: "Tệp", type: "attachments" },
  ],
  starters: { kind: "groups", group_keys: ["mua-hang"] },
  title_template: "Mua {{ item }} ({{amount}})",
});

describe("core.start-form", () => {
  test("zod theo cấu hình: bắt buộc, kiểu, ô lạ", () => {
    const s = startFormValuesSchema(CFG);
    expect(s.safeParse({ item: "Bút", amount: 10 }).success).toBe(true);
    expect(s.safeParse({ amount: 10 }).success).toBe(false);
    expect(s.safeParse({ item: "Bút", amount: -1 }).success).toBe(false);
    expect(s.safeParse({ item: "Bút", amount: 1, nope: 1 }).success).toBe(false);
    expect(s.safeParse({ item: "Bút", amount: 1, people: ["x"] }).success).toBe(false);
  });
  test("khoá ô trùng ⇒ cấu hình sai", () => {
    const bad = { ...CFG, fields: [CFG.fields[0], CFG.fields[0]] };
    expect(StartFormConfigSchema.safeParse(bad).success).toBe(false);
  });
  test("đầu ra = ô phiếu; input lượt; tên yêu cầu", () => {
    expect(startFormOutputs(CFG).map((o) => [o.key, o.type])).toEqual([
      ["item", "string"],
      ["amount", "number"],
      ["people", "string"],
      ["files", "string"],
    ]);
    expect(startFormRunInputs(CFG, { item: "Bút", amount: 10, people: [] })).toEqual([
      { key: "item", type: "text", text: "Bút" },
      { key: "amount", type: "number", value: "10" },
    ]);
    expect(renderStartTitle(CFG.title_template, { item: "Bút", amount: 10 })).toBe("Mua Bút (10)");
  });
  test("nhóm «ai được bắt đầu» là nhóm cần của mẫu, node có trong sổ module", () => {
    expect(startFormGroupKeys(CFG)).toEqual(["mua-hang"]);
    const needs = templateNeeds([{ key: "a", node: "core.start-form", start_form: CFG }], MODULES);
    expect(needs.groups).toEqual(["mua-hang"]);
    expect(MODULES.flatMap((m) => m.nodes).some((n) => n.key === "core.start-form")).toBe(true);
  });
});
