// CR-169 · P12: tin nhắn người–người KHÔNG vào ngữ cảnh trợ lý AI — các vùng của trợ lý không được import gói Tin nhắn / dữ liệu của nó.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "..", "..", "..");
const ASSISTANT_DIRS = [
  "features/thread",
  "features/composer",
  "features/answer",
  "features/agents",
  "features/conversations",
  "features/run",
  "features/commands",
  "features/flow-panel",
  "features/attachments",
];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("CR-169 · tin nhắn tách khỏi trợ lý AI", () => {
  test("vùng trợ lý không import @ai/messages-web, features/messages, msg-frames", () => {
    const bad: string[] = [];
    for (const d of ASSISTANT_DIRS) {
      for (const f of files(join(SRC, d))) {
        if (/\.test\.tsx?$/.test(f)) continue;
        const s = readFileSync(f, "utf8");
        if (
          /@ai\/messages-web|features\/messages|realtime\/msg-frames|\/pack\/contracts\/messages/.test(
            s,
          )
        )
          bad.push(f);
      }
    }
    expect(bad).toEqual([]);
  });
});
