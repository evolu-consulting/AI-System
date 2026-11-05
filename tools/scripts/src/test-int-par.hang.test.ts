// tool-evotest-hang · tích hợp nhẹ (không cần DB): file test giả cố tình treo (vòng lặp bận) chạy qua `drain` ⇒ bị SIGKILL
// trong ≤ idle+5 s, file còn lại vẫn chạy. Dùng `bun test` thật (có chờ thật vài giây — chính là thứ cần chứng minh).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drain } from "./test-int-par.run";

const root = mkdtempSync(join(tmpdir(), "int-hang-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ok = (n: string) => `import { it } from "bun:test"; it("${n}", () => {});\n`;

describe("tool-evotest-hang · drain + watchdog (bun test thật)", () => {
  it("file treo bị kill ≤ idle+5 s, file sau nó vẫn chạy xanh, tóm tắt đánh dấu treo", async () => {
    mkdirSync(join(root, ".data"), { recursive: true });
    writeFileSync(
      join(root, "hang.test.ts"),
      `import { it } from "bun:test"; it("treo", () => { for (;;) {} });\n`,
    );
    writeFileSync(join(root, "ok1.test.ts"), ok("ok1"));
    writeFileSync(join(root, "ok2.test.ts"), ok("ok2"));
    const logs: string[] = [];
    const idleS = 2;
    const t0 = performance.now();
    const runs = await drain(
      "s0",
      ["hang.test.ts", "ok1.test.ts", "ok2.test.ts"],
      (q) => q.splice(0),
      {
        env: {},
        root,
        cmd: ["bun", "test"],
        hang: { idleS, fileS: 0 },
        pollMs: 200,
        log: (l) => logs.push(l),
      },
    );
    const hung = runs.filter((r) => r.hung);
    expect(hung).toHaveLength(1);
    expect(hung[0]?.hung?.file).toBe("hang.test.ts");
    expect(hung[0]?.hung?.rest).toEqual(["ok1.test.ts", "ok2.test.ts"]);
    expect(hung[0]?.code).not.toBe(0);
    expect(hung[0]?.ms).toBeLessThan((idleS + 5) * 1000);
    expect(logs.join("\n")).toContain("TREO: hang.test.ts");
    // lô chạy tiếp gồm 2 file còn lại, xanh
    const rest = runs.filter((r) => !r.hung);
    expect(rest).toHaveLength(1);
    expect(rest[0]?.files).toBe(2);
    expect(rest[0]?.code).toBe(0);
    expect(rest[0]?.text).toMatch(/2 pass/);
    expect(performance.now() - t0).toBeLessThan(30_000);
  }, 40_000);
});
