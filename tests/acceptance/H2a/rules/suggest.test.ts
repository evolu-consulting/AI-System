// HUB-FR-14 · AC-H02 · H2a-R04 · levenshtein, suggestCommands (test-plan H2a §4 R27–R29, cases §1.3; chữ ký plan-rules).
import { describe, expect, it } from "bun:test";
import {
  levenshtein,
  type SuggestCandidate,
  suggestCommands,
} from "../../../../apps/hub-api/src/modules/commands/suggest.rules";

const c = (name: string, aliases: string[] = []): SuggestCandidate => ({ name, aliases });
const USABLE = [c("dich", ["translate"]), c("hoi"), c("so")];

describe("HUB-FR-14 · gợi ý lệnh [R27–R29]", () => {
  it("HUB-FR-14 · levenshtein theo code point trên NFC [R27]", () => {
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("dich", "dich")).toBe(0);
    expect(levenshtein("dihc", "dich")).toBe(2);
    expect(levenshtein("dịch", "dich")).toBe(1);
    expect(levenshtein("dịch".normalize("NFD"), "dịch".normalize("NFC"))).toBe(0);
  });

  it("HUB-FR-14 · AC-H02 · ngưỡng max(2,⌊len/3⌋), sắp khoảng cách rồi tên, alias → tên chính, ≤ 3 [R28]", () => {
    expect(suggestCommands("dihc", USABLE)).toEqual(["dich"]);
    // len 9 → ngưỡng 3: khoảng cách 3 giữ, 4 loại.
    expect(suggestCommands("abcdefghi", [c("abcdefxyz"), c("abcdewxyz")])).toEqual(["abcdefxyz"]);
    // khoảng cách 1,1,2,2 → sắp (khoảng cách, tên), cắt 3.
    const many = [c("bcc"), c("bbbb"), c("bbcc"), c("abbb")];
    expect(suggestCommands("bbb", many)).toEqual(["abbb", "bbbb", "bbcc"]);
    expect(suggestCommands("translat", USABLE)).toEqual(["dich"]);
    expect(suggestCommands("dic", [c("dich", ["dicht"])])).toEqual(["dich"]);
  });

  it("HUB-FR-14 · AC-H11 · rỗng/không gần → []; lệnh ngoài usable không xuất hiện [R29]", () => {
    expect(suggestCommands("", USABLE)).toEqual([]);
    expect(suggestCommands("zzzzzz", USABLE)).toEqual([]);
    expect(suggestCommands("tomm", USABLE)).not.toContain("tom");
    expect(suggestCommands("tom", [c("dich")])).toEqual([]);
  });
});
