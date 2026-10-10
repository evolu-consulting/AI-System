// HUB-BR-28 · M2 · R-B01…R-B06 — `classifyBang` (core/bang.rules.ts, plan-contract §7, plan §7). Nạp động: module vắng ⇒ đỏ ở expect.
import { describe, expect, it } from "bun:test";
import { fn, loadCoreRules } from "../../_support/modules";

const classify = async () => fn(await loadCoreRules("bang"), "classifyBang");

describe("R-B · cú pháp `!` [HUB-BR-28]", () => {
  it("HUB-BR-28 · R-B01 · rỗng, chữ thường, `!` giữa câu, `/`, `@` ⇒ none", async () => {
    const f = await classify();
    for (const s of ["", "xin chào", "abc !hoa-don", "/dich", "@hoadon x"])
      expect(f(s)).toEqual({ kind: "none" });
  });
  it("HUB-BR-28 · R-B02 · `!hoa-don HD-12 tháng 9` ⇒ process + key + input", async () => {
    const f = await classify();
    expect(f("!hoa-don HD-12 tháng 9")).toEqual({
      kind: "process",
      key: "hoa-don",
      input: "HD-12 tháng 9",
    });
  });
  it("HUB-BR-28 · R-B03 · khoảng trắng đầu bỏ; key chữ thường; input trim", async () => {
    const f = await classify();
    expect(f("   !hoa-don")).toEqual({ kind: "process", key: "hoa-don", input: "" });
    expect(f("!HOA-DON  x  ")).toEqual({ kind: "process", key: "hoa-don", input: "x" });
  });
  it("HUB-BR-28 · R-B04 · `!!` ⇒ escaped, bỏ một `!` (M2)", async () => {
    const f = await classify();
    expect(f("!!hello")).toEqual({ kind: "escaped", content: "!hello" });
    expect(f("!!")).toEqual({ kind: "escaped", content: "!" });
  });
  it("HUB-BR-28 · R-B05 · `!` trơn / token sai dạng ⇒ invalid kèm token sau `!`", async () => {
    const f = await classify();
    const long = "a".repeat(33);
    const cases: [string, string][] = [
      ["!", ""],
      ["!a x", "a"],
      [`!${long}`, long],
      ["!hoa_don", "hoa_don"],
      ["!hoá", "hoá"],
    ];
    for (const [s, token] of cases) expect(f(s)).toEqual({ kind: "invalid", token });
  });
  it("HUB-BR-28 · R-B06 · input giữ xuống dòng giữa", async () => {
    const f = await classify();
    expect(f("!hoa-don dòng1\ndòng2")).toEqual({
      kind: "process",
      key: "hoa-don",
      input: "dòng1\ndòng2",
    });
  });
});
