// ADM-FR-20, ADM-BR-01 · M2-R13…R15 · commandSchema (tên/alias/feature/timeout/tham số) và chuyển form ↔ body.
import { describe, expect, test } from "bun:test";
import { emptyCommandForm, toInputMap, toRequestBody } from "./defaults";
import { type CommandFormValues, commandSchema } from "./schemas";

const valid = (over: Partial<CommandFormValues> = {}): CommandFormValues => ({
  ...emptyCommandForm(),
  name: "dich-moi",
  description: { vi: "Mô tả", en: "" },
  workflow_id: "wf",
  feature_ids: ["f1"],
  output_field: "text",
  ...over,
});
const first = (v: CommandFormValues) => {
  const r = commandSchema.safeParse(v);
  return r.success ? null : (r.error.issues[0]?.message ?? null);
};

describe("ADM-BR-01 · commandSchema", () => {
  test("form hợp lệ tối thiểu", () => {
    expect(first(valid())).toBeNull();
  });

  test("tên: chữ thường/số/-, 2–32", () => {
    expect(first(valid({ name: "a" }))).toBe("commands.error.nameFormat");
    expect(first(valid({ name: "Dich" }))).toBe("commands.error.nameFormat");
    expect(first(valid({ name: "x".repeat(33) }))).toBe("commands.error.nameFormat");
  });

  test("alias: ≤ 5, không trùng nhau hay trùng tên", () => {
    const five = ["a1", "a2", "a3", "a4", "a5"];
    expect(first(valid({ aliases: five }))).toBeNull();
    expect(first(valid({ aliases: [...five, "a6"] }))).toBe("commands.error.aliasMax");
    expect(first(valid({ aliases: ["tr", "tr"] }))).toBe("commands.error.aliasDup");
    expect(first(valid({ aliases: ["dich-moi"] }))).toBe("commands.error.aliasDup");
  });

  test("mô tả VI bắt buộc ≤ 200; feature rỗng hợp lệ (CR-055); workflow bắt buộc", () => {
    expect(first(valid({ description: { vi: "  ", en: "" } }))).toBe("commands.error.descRequired");
    expect(first(valid({ description: { vi: "x".repeat(201), en: "" } }))).toBe(
      "commands.error.descRequired",
    );
    expect(first(valid({ feature_ids: [] }))).toBeNull();
    expect(first(valid({ workflow_id: "" }))).toBe("commands.error.workflowRequired");
  });

  test("timeout: nguyên 1–600", () => {
    const e = "commands.error.timeout";
    expect(first(valid({ timeout_s: 0 }))).toBe(e);
    expect(first(valid({ timeout_s: 601 }))).toBe(e);
    expect(first(valid({ timeout_s: Number.NaN }))).toBe(e);
    expect(first(valid({ timeout_s: 1.5 }))).toBe(e);
    expect(first(valid({ timeout_s: 600 }))).toBeNull();
  });

  test("tham số: tên hợp lệ, không trùng, chỉ tham số cuối được nuốt phần còn lại", () => {
    const arg = (name: string, rest = false) => ({
      name,
      description: { vi: "m", en: "" },
      default: "",
      fallback: "none" as const,
      rest,
    });
    expect(first(valid({ args: [arg("Lang")] }))).toBe("commands.error.argName");
    expect(first(valid({ args: [arg("a"), arg("a")] }))).toBe("commands.error.argDup");
    expect(first(valid({ args: [arg("a", true), arg("b")] }))).toBe("commands.error.argRest");
    expect(first(valid({ args: [arg("a"), arg("b", true)] }))).toBeNull();
  });
});

describe("ADM-FR-20 · toRequestBody / toInputMap", () => {
  test("map: bỏ mục chưa chọn nguồn; chỉ arg/const có value", () => {
    expect(
      toInputMap({
        a: { source: "", value: "" },
        b: { source: "selection", value: "ignored" },
        c: { source: "arg", value: "lang" },
        d: { source: "const", value: "vi" },
      }),
    ).toEqual({
      b: { source: "selection" },
      c: { source: "arg", value: "lang" },
      d: { source: "const", value: "vi" },
    });
  });

  test("body: EN rỗng bị bỏ, default rỗng → null, fallback none → null", () => {
    const body = toRequestBody(
      valid({
        description: { vi: " Dịch ", en: "  " },
        args: [
          {
            name: "lang",
            description: { vi: "Ngôn ngữ", en: "Lang" },
            default: " ",
            fallback: "none",
            rest: false,
          },
        ],
      }),
    );
    expect(body.description).toEqual({ vi: "Dịch" });
    expect(body.args[0]).toEqual({
      name: "lang",
      description: { vi: "Ngôn ngữ", en: "Lang" },
      default: null,
      fallback: null,
      rest: false,
    });
    expect(body.output).toEqual({ field: "text", render: "markdown" });
  });
});
