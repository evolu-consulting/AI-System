// HUB-FR-11 · HUB-BR-01 · HUB-H2a-AC-01 · H2a-R01, R05 · classifyMessage, tokenize, bindArgs
// (test-plan H2a §4 R01–R14, cases §1.1; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import {
  bindArgs,
  classifyMessage,
  tokenize,
} from "../../../../apps/hub-api/src/modules/commands/command-parse.rules";
import { arg } from "./_catalog";

const LANG = arg("lang");
const TEXT = arg("text");
const TEXT_REST = arg("text", { rest: true });

describe("HUB-FR-11 · classifyMessage [R01–R04]", () => {
  it("HUB-FR-11 · HUB-BR-01 · tin thường vs lệnh `/` [R01]", () => {
    expect(classifyMessage("xin chào")).toEqual({ kind: "text", content: "xin chào" });
    expect(classifyMessage("/dich en")).toEqual({ kind: "command", name: "dich", rest: "en" });
    expect(classifyMessage("a /dich")).toEqual({ kind: "text", content: "a /dich" });
  });

  it("HUB-BR-01 · HUB-H2a-AC-09 · `//` → text bỏ đúng một `/` [R02]", () => {
    expect(classifyMessage("//abc")).toEqual({ kind: "text", content: "/abc" });
    expect(classifyMessage("///x")).toEqual({ kind: "text", content: "//x" });
    expect(classifyMessage("  //a")).toEqual({ kind: "text", content: "/a" });
  });

  it("HUB-BR-01 · tên rỗng, tên lower [R03]", () => {
    expect(classifyMessage("/")).toMatchObject({ kind: "command", name: "" });
    expect(classifyMessage("/ abc")).toMatchObject({ kind: "command", name: "" });
    expect(classifyMessage("/DICH x")).toEqual({ kind: "command", name: "dich", rest: "x" });
    expect(classifyMessage("/Translate")).toMatchObject({ kind: "command", name: "translate" });
  });

  it("HUB-BR-01 · khoảng trắng đầu (tab, xuống dòng) bị bỏ trước khi phân loại [R04]", () => {
    expect(classifyMessage("\t\n  /dich en")).toEqual({
      kind: "command",
      name: "dich",
      rest: "en",
    });
  });
});

describe("HUB-FR-11 · tokenize [R05–R07, R14]", () => {
  it("HUB-FR-11 · tách theo khoảng trắng ASCII, chuỗi rỗng → [] [R05]", () => {
    expect(tokenize("a  b\tc")).toEqual(["a", "b", "c"]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it('HUB-FR-11 · `"…"` gom một token, `\\"` thoát, `""` → token rỗng [R06]', () => {
    expect(tokenize('"hello world" x')).toEqual(["hello world", "x"]);
    expect(tokenize('"a \\"b\\" c"')).toEqual(['a "b" c']);
    expect(tokenize('""')).toEqual([""]);
  });

  it("HUB-FR-11 · ngoặc không đóng → tới hết chuỗi là một token (Q-T9) [R07]", () => {
    expect(tokenize('"abc def')).toEqual(["abc def"]);
  });

  it("HUB-FR-11 · dấu/emoji giữ nguyên; U+00A0 không tách (Q-T10) [R14]", () => {
    expect(tokenize("dịch 🚀 Ngữ")).toEqual(["dịch", "🚀", "Ngữ"]);
    expect(tokenize("a b c")).toEqual(["a b", "c"]);
  });
});

describe("HUB-FR-11 · HUB-H2a-AC-01 · bindArgs [R08–R13]", () => {
  it("HUB-FR-11 · gán theo vị trí [R08]", () => {
    expect(bindArgs([LANG, TEXT], "en xin", {})).toEqual({
      values: { lang: "en", text: "xin" },
      extra: 0,
    });
  });

  it("HUB-FR-11 · `rest=true` nuốt nguyên văn phần còn lại, trim hai đầu (Q-T9) [R09]", () => {
    expect(bindArgs([LANG, TEXT_REST], "en  hello   world  ", {}).values).toEqual({
      lang: "en",
      text: "hello   world",
    });
    expect(bindArgs([LANG, TEXT_REST], 'en "a  b" c', {}).values).toEqual({
      lang: "en",
      text: '"a  b" c',
    });
  });

  it("HUB-FR-11 · thiếu → `default`; có cả default và fallback → default thắng [R10]", () => {
    const tone = arg("tone", { default: "neutral" });
    expect(bindArgs([LANG, tone], "en", {}).values).toEqual({ lang: "en", tone: "neutral" });
    const both = arg("text", { default: "mặc định", fallback: "selection" });
    expect(bindArgs([LANG, both], "en", { selection: "vùng chọn" }).values.text).toBe("mặc định");
  });

  it("HUB-H2a-AC-01 · thiếu → fallback `$selection` từ context [R11]", () => {
    const text = arg("text", { rest: true, fallback: "selection" });
    expect(bindArgs([LANG, text], "en", { selection: "xin chào" })).toEqual({
      values: { lang: "en", text: "xin chào" },
      extra: 0,
    });
  });

  it("HUB-FR-11 · thiếu không default/fallback → null; `$selection` mà ctx không có → null [R12]", () => {
    expect(bindArgs([LANG, TEXT], "en", {}).values).toEqual({ lang: "en", text: null });
    const text = arg("text", { fallback: "selection" });
    expect(bindArgs([LANG, text], "", {}).values).toEqual({ lang: null, text: null });
  });

  it("HUB-FR-11 · thừa token khi không có `rest` → bỏ, đếm `extra` [R13]", () => {
    expect(bindArgs([LANG], "en a b", {})).toEqual({ values: { lang: "en" }, extra: 2 });
  });
});
