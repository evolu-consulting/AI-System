import { describe, expect, test } from "bun:test";
import {
  ArgsSchema,
  type Command,
  CommandAccessResponseSchema,
  CommandArgSchema,
  CommandCreateRequestSchema,
  CommandListQuerySchema,
  CommandListResponseSchema,
  CommandSchema,
  CommandUpdateRequestSchema,
  InputMapEntrySchema,
  InputMapSchema,
} from "./index";
import { TENANT_ID as ID, T0, T1, USER_ID as WF_ID } from "./test-fixtures";

const desc = { vi: "Dịch" };
const create = {
  name: "dich",
  description: desc,
  workflow_id: WF_ID,
  output: { field: "text", render: "markdown" as const },
};
const command: Command = {
  id: ID,
  name: "dich",
  aliases: ["translate"],
  description: desc,
  workflow: { id: WF_ID, key: "translate", name: "Dịch", enabled: true },
  features: [{ id: ID, key: "core", name: { vi: "Mặc định" }, status: "on" }],
  mode: "sync",
  enabled: true,
  version: 1,
  updated_at: T1,
  updated_by: "admin",
  args: [{ name: "lang", description: desc, default: null, fallback: null, rest: false }],
  input_map: {
    source_text: { source: "selection" },
    target_lang: { source: "arg", value: "lang" },
  },
  output: { field: "text", render: "markdown" },
  timeout_s: 30,
  feature_ids: [ID],
  warnings: [{ var: "n", type: "number", source: "selection", reason: "type_mismatch" }],
  created_at: T0,
};

describe("ADM-FR-20 · M2-R15 · args", () => {
  test("mặc định default/fallback null, rest false; default rỗng → null", () => {
    expect(CommandArgSchema.parse({ name: "lang", description: desc, default: " " })).toEqual({
      name: "lang",
      description: desc,
      default: null,
      fallback: null,
      rest: false,
    });
  });

  test("tên không trùng; rest tối đa 1 và ở cuối; tối đa 20", () => {
    const a = (name: string, rest = false) => ({ name, description: desc, rest });
    expect(ArgsSchema.safeParse([a("a"), a("b", true)]).success).toBe(true);
    expect(ArgsSchema.safeParse([a("a", true), a("b")]).error?.issues[0]?.path).toEqual([
      0,
      "rest",
    ]);
    expect(ArgsSchema.safeParse([a("a", true), a("b", true)]).success).toBe(false);
    expect(ArgsSchema.safeParse([a("a"), a("a")]).error?.issues[0]?.path).toEqual([1, "name"]);
    const many = Array.from({ length: 21 }, (_, i) => a(`a${i}`));
    expect(ArgsSchema.safeParse(many).success).toBe(false);
  });

  test.each([
    ["tên hoa", { name: "Lang", description: desc }],
    ["fallback lạ", { name: "a", description: desc, fallback: "attachment" }],
    ["default 1001", { name: "a", description: desc, default: "x".repeat(1001) }],
  ])("từ chối: %s", (_n, v) => {
    expect(CommandArgSchema.safeParse(v).success).toBe(false);
  });
});

describe("ADM-FR-21 · M2-R16 · input map", () => {
  test.each([
    [{ source: "arg", value: "lang" }, true],
    [{ source: "const", value: "vi" }, true],
    [{ source: "page_url" }, true],
    [{ source: "arg" }, false],
    [{ source: "selection", value: "x" }, false],
    [{ source: "const", value: "x".repeat(4001) }, false],
    [{ source: "clipboard" }, false],
  ])("%j → %p", (entry, ok) => {
    expect(InputMapEntrySchema.safeParse(entry).success).toBe(ok);
  });

  test("khoá theo INPUT_NAME_RE, tối đa 50", () => {
    expect(InputMapSchema.safeParse({ "1x": { source: "selection" } }).success).toBe(false);
    const many = Object.fromEntries(
      Array.from({ length: 51 }, (_, i) => [`v${i}`, { source: "selection" }]),
    );
    expect(InputMapSchema.safeParse(many).success).toBe(false);
  });
});

describe("ADM-FR-20 · M2-R13 · create/update", () => {
  test("mặc định aliases/args/input_map rỗng, mode sync, enabled true; timeout_s, feature_ids vắng", () => {
    const r = CommandCreateRequestSchema.parse({ ...create, name: " DICH " });
    expect(r).toEqual({
      ...create,
      aliases: [],
      args: [],
      input_map: {},
      mode: "sync",
      enabled: true,
    });
  });

  test("CR-055 · feature_ids [] hợp lệ (command chưa gắn feature)", () => {
    expect(CommandCreateRequestSchema.safeParse({ ...create, feature_ids: [] }).success).toBe(true);
  });

  test.each([
    ["alias trùng tên", { ...create, aliases: ["dich"] }],
    ["alias trùng nhau", { ...create, aliases: ["a1", "a1"] }],
    ["6 alias", { ...create, aliases: ["a1", "a2", "a3", "a4", "a5", "a6"] }],
    ["tên có dấu", { ...create, name: "dịch" }],
    ["timeout 0", { ...create, timeout_s: 0 }],
    ["timeout 601", { ...create, timeout_s: 601 }],
    ["thiếu output.field", { ...create, output: { render: "text" } }],
    ["mode lạ", { ...create, mode: "stream" }],
    ["feature_ids trùng", { ...create, feature_ids: [ID, ID] }],
    ["trường lạ", { ...create, test: true }],
  ])("create từ chối: %s", (_n, v) => {
    expect(CommandCreateRequestSchema.safeParse(v).success).toBe(false);
  });

  test("alias được chuẩn hoá trước khi so tên", () => {
    expect(CommandCreateRequestSchema.safeParse({ ...create, aliases: [" DICH "] }).success).toBe(
      false,
    );
  });

  test("update: mọi trường tuỳ chọn trừ version; không default", () => {
    expect(CommandUpdateRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(CommandUpdateRequestSchema.safeParse({ enabled: true }).success).toBe(false);
    expect(
      CommandUpdateRequestSchema.safeParse({ version: 1, name: "a", aliases: ["a"] }).success,
    ).toBe(false);
  });
});

describe("ADM-FR-22 · ADM-FR-24 · response", () => {
  test("Command strict", () => {
    expect(CommandSchema.parse(command)).toEqual(command);
    expect(CommandSchema.safeParse({ ...command, warnings: undefined }).success).toBe(false);
  });

  test("list query + counts {all,on,off}", () => {
    expect(CommandListQuerySchema.parse({ status: "on", feature: ID })).toMatchObject({
      feature: ID,
    });
    expect(CommandListQuerySchema.safeParse({ feature: "core" }).success).toBe(false);
    const { args, input_map, output, timeout_s, feature_ids, warnings, created_at, ...item } =
      command;
    const ok = { items: [item], total: 1, counts: { all: 1, on: 1, off: 0 } };
    expect(CommandListResponseSchema.parse(ok)).toEqual(ok);
  });

  test("access {items,total,command_active}", () => {
    const ok = {
      items: [
        {
          tenant_id: ID,
          tenant_key: "acme",
          tenant_name: "Acme",
          tenant_active: true,
          features: [{ id: ID, key: "core", name: { vi: "Mặc định" } }],
          active_user_count: 5,
          groups: [],
          group_count: 0,
          visible_user_count: 3,
        },
      ],
      total: 1,
      command_active: false,
    };
    expect(CommandAccessResponseSchema.parse(ok)).toEqual(ok);
    expect(CommandAccessResponseSchema.safeParse({ items: [], total: 0 }).success).toBe(false);
  });
});
