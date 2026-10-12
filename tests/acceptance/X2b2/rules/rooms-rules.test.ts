// HUB-FR-44 · HUB-BR-28 · X2b2-R20, D8 · luật thuần `rooms.rules.ts` `roomFilesAllowed` (plan §8, test-plan X2b2 §2 U09).
// Ví dụ cú pháp `!` theo khoá P-a `step0/rules/bang.test.ts` (R-B01…R-B05). Nạp động ⇒ export vắng ⇒ đỏ ở `expect(typeof)`.
import { describe, expect, it } from "bun:test";
import { type Fn, loadRoomsRules } from "../_modules";

async function fn(name: string): Promise<Fn> {
  const m = await loadRoomsRules();
  expect(typeof m[name]).toBe("function");
  return m[name];
}

describe("D8 · roomFilesAllowed({content, flowId?, answerRunId?, processEngine}) [plan §8]", () => {
  it("HUB-FR-44 · X2b2-AC16 · U09 · `!…` timeline + engine bật ⇒ false; còn lại ⇒ true", async () => {
    const ok = await fn("roomFilesAllowed");
    const F = "a2b20000-0000-4000-8000-000000000001";
    const R = "a2b20000-0000-4000-8000-000000000002";
    const table: [string, Record<string, unknown>, boolean][] = [
      ["!hoa-don x, engine bật, không flow", { content: "!hoa-don x", processEngine: true }, false],
      ["`!` trơn (invalid), engine bật", { content: "!", processEngine: true }, false],
      ["`!a x` sai dạng (invalid), engine bật", { content: "!a x", processEngine: true }, false],
      ["!hoa-don x, engine tắt", { content: "!hoa-don x", processEngine: false }, true],
      ["!hoa-don x, có flowId", { content: "!hoa-don x", flowId: F, processEngine: true }, true],
      [
        "!hoa-don x, có answerRunId (+ flowId)",
        { content: "!hoa-don x", flowId: F, answerRunId: R, processEngine: true },
        true,
      ],
      ["chữ thường", { content: "đây là hoá đơn", processEngine: true }, true],
      ["@hoadon kiểm tra file", { content: "@hoadon kiểm tra file", processEngine: true }, true],
      ["`!!` escaped", { content: "!!hello", processEngine: true }, true],
    ];
    for (const [label, p, want] of table)
      expect({ label, got: ok(p) }).toEqual({ label, got: want });
  });
});
