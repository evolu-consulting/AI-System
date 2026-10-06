// HUB-FR-91 · luật thuần menu `@`: mở/đóng, lọc, điền, thay tag.
import { describe, expect, test } from "bun:test";
import type { AgentMenuItem } from "@ai/contracts/chat";
import { fillAgent, filterAgents, leadingTag, mentionQuery, replaceTag } from "./mention";

const item = (key: string, vi: string, en = vi): AgentMenuItem => ({
  key,
  name: { vi, en },
  description: "Mô tả agent đủ hai mươi ký tự.",
});
const items = [
  item("trello", "Trợ lý Trello"),
  item("dify-chatbot", "Chatbot (Dify)", "Dify chatbot"),
];

describe("mentionQuery", () => {
  test("mở khi token tại con trỏ bắt đầu @", () => {
    expect(mentionQuery("@", 1)).toBe("");
    expect(mentionQuery("@tr", 3)).toBe("tr");
    expect(mentionQuery("@a @tr", 6)).toBe("tr");
    expect(mentionQuery("@a @b x", 7)).toBeNull();
  });
  test("không mở: @@, chữ thường trước, @ giữa chữ", () => {
    expect(mentionQuery("@@x", 3)).toBeNull();
    expect(mentionQuery("hỏi @tr", 7)).toBeNull();
    expect(mentionQuery("a@b", 3)).toBeNull();
    expect(mentionQuery("@a xin chào", 11)).toBeNull();
  });
});

describe("filterAgents / fill / tag", () => {
  test("lọc tiền tố key hoặc chứa trong tên, theo ngôn ngữ", () => {
    expect(filterAgents(items, "", "vi").map((m) => m.item.key)).toEqual([
      "dify-chatbot",
      "trello",
    ]);
    expect(filterAgents(items, "tr", "vi").map((m) => m.item.key)).toEqual(["trello"]);
    expect(filterAgents(items, "bot", "vi").map((m) => m.item.key)).toEqual(["dify-chatbot"]);
    expect(filterAgents(items, "dify c", "en").map((m) => m.item.key)).toEqual(["dify-chatbot"]);
  });
  test("fillAgent thay token tại con trỏ, giữ phần sau", () => {
    expect(fillAgent("@tr", 3, "trello")).toEqual({ text: "@trello ", caret: 8 });
    expect(fillAgent("@a @tr xin", 6, "trello")).toEqual({ text: "@a @trello xin", caret: 11 });
  });
  test("leadingTag / replaceTag", () => {
    expect(leadingTag("@a xin")).toBe("a");
    expect(leadingTag("@@a")).toBeNull();
    expect(replaceTag("@dify-chatbot2 xin chào", "dify-chatbot2", "dify-chatbot")).toBe(
      "@dify-chatbot xin chào",
    );
    expect(replaceTag("@a @bad x", "bad", "good")).toBe("@a @good x");
  });
});
