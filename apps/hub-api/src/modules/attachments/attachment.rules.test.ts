// HUB-FR-44 · H2c-R02 · REVIEW 1 — Hub RV-6: tên thiết bị Windows dạng số mũ / nhiều đuôi; ký tự vô hình bổ sung.
import { describe, expect, test } from "bun:test";
import { displayName, safeName } from "./attachment.rules";

const ch = (...cps: number[]) => String.fromCodePoint(...cps);

describe("safeName thiết bị Windows [RV-6]", () => {
  test("số mũ ¹²³ và phần trước dấu chấm đầu tiên", () => {
    const cases: [string, string][] = [
      [`COM${ch(0xb9)}.txt`, `COM${ch(0xb9)}_.txt`],
      [`lpt${ch(0xb2)}.md`, `lpt${ch(0xb2)}_.md`],
      [`LPT${ch(0xb3)}`, `LPT${ch(0xb3)}_`],
      ["CON.tar.pdf", "CON_.tar.pdf"],
      ["nul.a.b.csv", "nul_.a.b.csv"],
      ["CONX.tar.pdf", "CONX.tar.pdf"],
      ["a.CON.pdf", "a.CON.pdf"],
      ["COM10.txt", "COM10.txt"],
    ];
    for (const [raw, want] of cases) expect(safeName(raw)).toBe(want);
  });
});

describe("displayName ký tự vô hình [RV-6]", () => {
  test("U+061C, U+FEFF, U+2028, U+2029 bị bỏ", () => {
    expect(displayName(`a${ch(0x61c)}b${ch(0xfeff)}c${ch(0x2028)}d${ch(0x2029)}.md`)).toBe(
      "abcd.md",
    );
  });
});
