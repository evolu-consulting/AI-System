// HUB-FR-10 · toMenuItem — mục menu `/` từ catalog (test-plan H2a §4 R40–R42, cases §1.5; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import { CommandMenuItemSchema } from "@ai/contracts/chat";
import { toMenuItem } from "../../../../apps/hub-api/src/modules/commands/menu.rules";
import { arg, command, DICH_INPUTS, DICH_MAP, input, workflow } from "./_catalog";

const WF = workflow({
  inputSchema: [...DICH_INPUTS, input("mode", "text", { required: true })],
});
const CMD = command({
  aliases: ["translate"],
  description: { vi: "Dịch", en: "Translate" },
  args: [
    arg("lang", { en: "Language" }),
    arg("mode", { default: "fast" }),
    arg("note"),
    arg("text", { rest: true, fallback: "selection" }),
  ],
  inputMap: { ...DICH_MAP, mode: { source: "arg", value: "mode" } },
});

describe("HUB-FR-10 · toMenuItem [R40–R42]", () => {
  it("HUB-FR-10 · required = map vào input required ∧ default null ∧ fallback null; has_fallback, rest [R40]", () => {
    expect(toMenuItem(CMD, WF).args).toEqual([
      {
        name: "lang",
        description: { vi: "Tham số lang", en: "Language" },
        required: true,
        has_fallback: false,
        rest: false,
      },
      {
        name: "mode",
        description: { vi: "Tham số mode", en: null },
        required: false,
        has_fallback: false,
        rest: false,
      },
      {
        name: "note",
        description: { vi: "Tham số note", en: null },
        required: false,
        has_fallback: false,
        rest: false,
      },
      {
        name: "text",
        description: { vi: "Tham số text", en: null },
        required: false,
        has_fallback: true,
        rest: true,
      },
    ]);
  });

  it("HUB-FR-10 · parse CommandMenuItemSchema; không lộ workflow/input_map/secret/URL [R41]", () => {
    const item = toMenuItem(CMD, WF);
    expect(CommandMenuItemSchema.safeParse(item).success).toBe(true);
    expect(Object.keys(item).sort()).toEqual(["aliases", "args", "description", "name"]);
    const raw = JSON.stringify(item);
    for (const leak of ["workflow", "input_map", "inputMap", "secret", "base", "dify.test", WF.id])
      expect(raw).not.toContain(leak);
  });

  it("HUB-FR-10 · description.en vắng → null; alias giữ nguyên (≤ 5) [R42]", () => {
    const aliases = ["a1", "a2", "a3", "a4", "a5"];
    const item = toMenuItem(command({ aliases, description: { vi: "Chỉ tiếng Việt" } }), WF);
    expect(item).toMatchObject({
      name: "dich",
      aliases,
      description: { vi: "Chỉ tiếng Việt", en: null },
      args: [],
    });
  });
});
