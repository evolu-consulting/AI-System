import { describe, expect, test } from "bun:test";
import {
  CHAT_API_ERRORS,
  CHAT_COMMAND_ERRORS,
  CmdMissingArgDetailsSchema,
  CmdNotFoundDetailsSchema,
  CommandMenuItemSchema,
  CommandMenuResponseSchema,
  MessageContextSchema,
  SendMessageRequestSchema,
} from "./index";

const desc = { vi: "Tóm tắt", en: null };
const arg = { name: "text", description: desc, required: true, has_fallback: true, rest: true };
const item = { name: "tom-tat", aliases: ["tt"], description: desc, args: [arg] };

describe("H2a contract chat — chỉ thêm (plan §2.1)", () => {
  test("CommandMenuResponse hợp lệ; thừa trường → lỗi", () => {
    expect(CommandMenuResponseSchema.parse({ items: [item] })).toEqual({ items: [item] });
    expect(CommandMenuItemSchema.safeParse({ ...item, workflow_id: "x" }).success).toBe(false);
    expect(CommandMenuResponseSchema.safeParse({ items: [], total: 0 }).success).toBe(false);
  });

  test("CommandMenuItem: tên/alias theo CATALOG_KEY_RE, alias ≤ 5, args ≤ 20", () => {
    expect(CommandMenuItemSchema.safeParse({ ...item, name: "Tom Tat" }).success).toBe(false);
    expect(CommandMenuItemSchema.safeParse({ ...item, aliases: Array(6).fill("a") }).success).toBe(
      false,
    );
    expect(CommandMenuItemSchema.safeParse({ ...item, args: Array(21).fill(arg) }).success).toBe(
      false,
    );
    expect(
      CommandMenuItemSchema.safeParse({ ...item, description: { vi: "", en: null } }).success,
    ).toBe(false);
  });

  test("CommandMenuArg: tên theo ARG_NAME_RE, đủ cờ boolean", () => {
    expect(
      CommandMenuItemSchema.safeParse({ ...item, args: [{ ...arg, name: "1x" }] }).success,
    ).toBe(false);
    const { rest: _r, ...noRest } = arg;
    expect(CommandMenuItemSchema.safeParse({ ...item, args: [noRest] }).success).toBe(false);
  });

  test("items ≤ 500", () => {
    expect(CommandMenuResponseSchema.safeParse({ items: Array(500).fill(item) }).success).toBe(
      true,
    );
    expect(CommandMenuResponseSchema.safeParse({ items: Array(501).fill(item) }).success).toBe(
      false,
    );
  });

  test("MessageContext: giới hạn, page_url http(s), không trim, strict", () => {
    expect(MessageContextSchema.parse({ selection: "  a  " })).toEqual({ selection: "  a  " });
    expect(MessageContextSchema.safeParse({ selection: "" }).success).toBe(false);
    expect(MessageContextSchema.safeParse({ selection: "a".repeat(16_001) }).success).toBe(false);
    expect(MessageContextSchema.safeParse({ page_text: "a".repeat(50_000) }).success).toBe(true);
    expect(MessageContextSchema.safeParse({ page_text: "a".repeat(50_001) }).success).toBe(false);
    expect(MessageContextSchema.safeParse({ page_url: "https://x.vn/a" }).success).toBe(true);
    expect(MessageContextSchema.safeParse({ page_url: "ftp://x.vn" }).success).toBe(false);
    const longUrl = `https://${"a".repeat(2_041)}`;
    expect(MessageContextSchema.safeParse({ page_url: longUrl }).success).toBe(false);
    expect(MessageContextSchema.safeParse({ title: "x" }).success).toBe(false);
  });

  test("SendMessageRequest: context tuỳ chọn, trường lạ vẫn lỗi", () => {
    expect(SendMessageRequestSchema.parse({ content: "/tt", context: { selection: "s" } })).toEqual(
      {
        content: "/tt",
        context: { selection: "s" },
      },
    );
    expect(SendMessageRequestSchema.parse({ content: "hi" })).toEqual({ content: "hi" });
    expect(SendMessageRequestSchema.safeParse({ content: "hi", la: 1 }).success).toBe(false);
  });

  test("CHAT_COMMAND_ERRORS riêng, CHAT_API_ERRORS không có CMD_*", () => {
    expect(CHAT_COMMAND_ERRORS).toEqual({ CMD_NOT_FOUND: 404, CMD_MISSING_ARG: 422 });
    expect(Object.keys(CHAT_API_ERRORS).some((k) => k.startsWith("CMD_"))).toBe(false);
  });

  test("details CMD_*: suggestions ≤ 3, missing/invalid ≤ 50", () => {
    expect(CmdNotFoundDetailsSchema.safeParse({ suggestions: ["a", "b", "c"] }).success).toBe(true);
    expect(CmdNotFoundDetailsSchema.safeParse({ suggestions: ["a", "b", "c", "d"] }).success).toBe(
      false,
    );
    expect(CmdMissingArgDetailsSchema.safeParse({ missing: ["x"], invalid: [] }).success).toBe(
      true,
    );
    expect(
      CmdMissingArgDetailsSchema.safeParse({ missing: Array(51).fill("x"), invalid: [] }).success,
    ).toBe(false);
    expect(CmdMissingArgDetailsSchema.safeParse({ missing: [] }).success).toBe(false);
  });
});
