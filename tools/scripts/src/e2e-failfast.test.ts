// tool-evotest-cache · unit + chạy bun thật: stack e2e có tiến trình con chết ⇒ thoát NGAY cùng mã, kèm lý do.
import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeSpawn, isStackScript, watchChild } from "./e2e-failfast";

const PRELOAD = join(import.meta.dir, "e2e-failfast.ts");

describe("isStackScript / describeSpawn", () => {
  it("chỉ script `_*.ts` dưới e2e/ là stack", () => {
    expect(isStackScript("/app/e2e/P-a/_pa-stack.ts")).toBe(true);
    expect(isStackScript("F:\\w\\e2e\\combine\\_stack.ts")).toBe(true);
    expect(isStackScript("/app/e2e/support/prepare-db.ts")).toBe(false);
    expect(isStackScript("/app/tools/scripts/src/run-playwright.ts")).toBe(false);
  });
  it("mô tả lệnh ngắn, không lộ env", () => {
    const d = describeSpawn([
      ["/usr/bin/bun", "apps/hub-api/src/server.ts"],
      { env: { SECRET: "x" } },
    ]);
    expect(d).toBe("usr/bin/bun hub-api/src/server.ts");
  });
});

describe("watchChild", () => {
  it("exit ≠ 0 không do signal ⇒ die(code, lý do); exit 0 hoặc bị kill ⇒ im lặng", async () => {
    const calls: [number, string][] = [];
    const die = (c: number, m: string) => void calls.push([c, m]);
    watchChild({ exited: Promise.resolve(0) }, "ok", die);
    watchChild({ exited: Promise.resolve(143), signalCode: "SIGTERM" }, "killed", die);
    watchChild({ exited: Promise.resolve(3), signalCode: null }, "hub-api server.ts", die);
    await Bun.sleep(5);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(3);
    expect(calls[0]?.[1]).toContain("hub-api server.ts");
    expect(calls[0]?.[1]).toContain("[failfast]");
  });
});

describe("preload trên bun thật", () => {
  const rig = () => {
    const d = mkdtempSync(join(tmpdir(), "evo-ff-"));
    mkdirSync(join(d, "e2e/x"), { recursive: true });
    return d;
  };
  const body = `const c = Bun.spawn([process.execPath, "-e", "setTimeout(() => process.exit(7), 100)"], { stdout: "inherit", stderr: "inherit" });
setInterval(() => {}, 1000); // stack "sống" chờ /health như thật`;
  it("stack `_x-stack.ts`: con thoát mã 7 ⇒ stack thoát mã 7 trong vài giây, stderr có lý do", async () => {
    const d = rig();
    writeFileSync(join(d, "e2e/x/_x-stack.ts"), body);
    const t0 = performance.now();
    const p = Bun.spawn([process.execPath, "--preload", PRELOAD, join(d, "e2e/x/_x-stack.ts")], {
      env: { ...process.env, E2E_FAILFAST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await p.exited;
    expect(code).toBe(7);
    expect(await new Response(p.stderr).text()).toContain("[failfast]");
    expect(performance.now() - t0).toBeLessThan(20_000);
  });
  it("script không phải stack (ngoài e2e/_*.ts) KHÔNG bị canh: con chết, cha vẫn sống tới khi tự thoát", async () => {
    const d = rig();
    writeFileSync(
      join(d, "plain.ts"),
      `${body.replace("setInterval(() => {}, 1000);", "await Bun.sleep(600); process.exit(0); //")}`,
    );
    const p = Bun.spawn([process.execPath, "--preload", PRELOAD, join(d, "plain.ts")], {
      env: { ...process.env, E2E_FAILFAST: "1" },
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await p.exited).toBe(0);
  });
});
