// HUB-FR-10 · luật thuần menu `/`: mở/đóng, lọc tên+alias, cú pháp, điền lệnh.
import { describe, expect, test } from "bun:test";
import type { CommandMenuItem } from "@ai/contracts/chat";
import {
  argSyntax,
  describe as describeText,
  fillCommand,
  filterCommands,
  leadingCommand,
  replaceCommandName,
  slashQuery,
} from "./slash";

const d = (vi: string, en: string | null = null) => ({ vi, en });
const item = (name: string, aliases: string[] = []): CommandMenuItem => ({
  name,
  aliases,
  description: d("mô tả"),
  args: [],
});
const ITEMS = [item("reply"), item("summary"), item("translate", ["dich"])];

describe("slashQuery", () => {
  test("mở khi '/' ở đầu và chưa có khoảng trắng trước con trỏ", () => {
    expect(slashQuery("/", 1)).toBe("");
    expect(slashQuery("/tr", 3)).toBe("tr");
    expect(slashQuery("/translate en", 4)).toBe("tra");
  });
  test("không mở: '//', có khoảng trắng trước con trỏ, không bắt đầu '/'", () => {
    expect(slashQuery("//x", 3)).toBeNull();
    expect(slashQuery("/translate ", 11)).toBeNull();
    expect(slashQuery("xin /tr", 7)).toBeNull();
    expect(slashQuery("", 0)).toBeNull();
  });
});

describe("filterCommands", () => {
  test("tiền tố name, không phân biệt hoa thường, giữ thứ tự Hub", () => {
    expect(filterCommands(ITEMS, "").map((m) => m.item.name)).toEqual([
      "reply",
      "summary",
      "translate",
    ]);
    expect(filterCommands(ITEMS, "TR").map((m) => m.item.name)).toEqual(["translate"]);
  });
  test("khớp alias → báo alias; khớp name → alias null", () => {
    expect(filterCommands(ITEMS, "dich")).toEqual([
      { item: ITEMS[2] as CommandMenuItem, alias: "dich" },
    ]);
    expect(filterCommands(ITEMS, "tra")[0]?.alias).toBeNull();
    expect(filterCommands(ITEMS, "zzz")).toEqual([]);
  });
});

describe("cú pháp, mô tả", () => {
  const arg = (name: string, required: boolean, rest: boolean) => ({
    name,
    description: d("x"),
    required,
    has_fallback: false,
    rest,
  });
  test("<bắt buộc> [tuỳ chọn] và … cho rest", () => {
    expect(argSyntax(arg("lang", false, false))).toBe("[lang]");
    expect(argSyntax(arg("text", true, true))).toBe("<text…>");
  });
  test("en null → vi", () => {
    expect(describeText(d("Dịch", "Translate"), "en")).toBe("Translate");
    expect(describeText(d("Dịch"), "en")).toBe("Dịch");
    expect(describeText(d("Dịch", "Translate"), "vi")).toBe("Dịch");
  });
});

describe("leadingCommand, fillCommand", () => {
  test("tên lệnh đầu tin; '//x' và tin thường → null", () => {
    expect(leadingCommand("/tranlate en hi")).toBe("tranlate");
    expect(leadingCommand("//x")).toBeNull();
    expect(leadingCommand("xin chào")).toBeNull();
  });
  test("điền '/name ' thay token đầu, giữ phần sau", () => {
    expect(fillCommand("/tr", "translate")).toEqual({ text: "/translate ", caret: 11 });
    expect(fillCommand("/tr hello", "translate")).toEqual({ text: "/translate hello", caret: 11 });
  });
  test("đổi tên lệnh giữ đối số", () => {
    expect(replaceCommandName("/tranlate en hello", "translate")).toBe("/translate en hello");
  });
});

test("filterCommands sắp theo name dù Hub trả lộn xộn", () => {
  const messy = [item("translate", ["dich"]), item("summary"), item("reply")];
  expect(filterCommands(messy, "").map((m) => m.item.name)).toEqual([
    "reply",
    "summary",
    "translate",
  ]);
});
