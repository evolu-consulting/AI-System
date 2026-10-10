// CHAT-AC-51 · CHAT-AC-52 · luật thuần `!key` ở composer.
import { describe, expect, test } from "bun:test";
import type { ProcessCatalogItem } from "@ai/contracts/chat";
import { bangQuery, classifyBang, fillBang, filterProcesses } from "./bang";

const item = (key: string, name: string): ProcessCatalogItem => ({
  key,
  name,
  description: "",
  input_hint: "",
  stage_count: 2,
});

describe("bangQuery", () => {
  test("mở khi ! ở đầu tin và con trỏ trong token đầu", () => {
    expect(bangQuery("!", 1)).toBe("");
    expect(bangQuery("!hoa", 4)).toBe("hoa");
    expect(bangQuery("!hoa", 3)).toBe("ho");
  });
  test("đóng: !!, ! không ở đầu, đã gõ khoảng trắng, con trỏ trước !", () => {
    expect(bangQuery("!!x", 3)).toBeNull();
    expect(bangQuery("a !x", 4)).toBeNull();
    expect(bangQuery("!hoa-don ", 9)).toBeNull();
    expect(bangQuery("!hoa-don x", 10)).toBeNull();
    expect(bangQuery("!x", 0)).toBeNull();
    expect(bangQuery("/x", 2)).toBeNull();
  });
});

describe("filterProcesses", () => {
  const items = [item("hoa-don-t", "Hoá đơn T"), item("sdlc", "Phát triển phần mềm")];
  test("khớp key hoặc tên, bỏ dấu, giữ thứ tự", () => {
    expect(filterProcesses(items, "hoa").map((m) => m.item.key)).toEqual(["hoa-don-t"]);
    expect(filterProcesses(items, "hoá đ").map((m) => m.item.key)).toEqual(["hoa-don-t"]);
    expect(filterProcesses(items, "phat trien").map((m) => m.item.key)).toEqual(["sdlc"]);
    expect(filterProcesses(items, "").length).toBe(2);
    expect(filterProcesses(items, "zzz")).toEqual([]);
  });
});

describe("fillBang", () => {
  test("thay token đầu, giữ phần còn lại", () => {
    expect(fillBang("!ho", "hoa-don-t")).toEqual({ text: "!hoa-don-t ", caret: 11 });
    expect(fillBang("!ho  abc", "hoa-don-t")).toEqual({ text: "!hoa-don-t abc", caret: 11 });
  });
});

describe("classifyBang", () => {
  test("!key input ⇒ run (key chữ thường, input trim)", () => {
    expect(classifyBang("!Hoa-Don-T  HD-1 ")).toEqual({
      kind: "run",
      key: "hoa-don-t",
      input: "HD-1",
    });
    expect(classifyBang("  !sdlc")).toEqual({ kind: "run", key: "sdlc", input: "" });
  });
  test("chữ thường / !! / ! trơn / key sai dạng ⇒ none", () => {
    for (const t of ["xin chào", "!!x", "!", "! x", "!a", "!ab_c x", "a !sdlc"]) {
      expect(classifyBang(t)).toEqual({ kind: "none" });
    }
  });
});
