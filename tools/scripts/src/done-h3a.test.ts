// HUB-H3a · WRK-FR-22 · `done:h3a` (test-plan H3a §6): mọi bước `done:h2c` giữ thứ tự + phần H3a; script/bunfig MK.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h2cSteps } from "./done-h2c";
import { h3aSteps } from "./done-h3a";

const ROOT = join(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

const c = h2cSteps({});
const a = h3aSteps({});
const titles = a.map((s) => s.title);

describe("HUB-H3a · done:h3a", () => {
  it("19 bước; mọi bước done:h2c có mặt, giữ thứ tự (unit/int chỉ nối thêm H3a)", () => {
    expect(a).toHaveLength(c.length + 1);
    const pos = c.map((s) =>
      titles.findIndex((t) => t.startsWith(s.title.split(" tests/")[0] ?? s.title)),
    );
    expect(pos.every((p) => p >= 0)).toBe(true);
    expect([...pos].sort((x, y) => x - y)).toEqual(pos);
    for (const s of c.filter(
      (x) => !/^bun (test|--env-file=\.env\.local --config=bunfig\.int)/.test(x.title),
    ))
      expect(titles).toContain(s.title);
  });

  it("unit + int có thư mục H3a; không đổi perf", () => {
    const unit = a.find((s) => s.title.startsWith("bun test "));
    expect(unit?.argv.at(-1)).toBe("tests/acceptance/H3a/rules");
    const int = a.find((s) => s.title.includes("--config=bunfig.int.toml"))?.argv ?? [];
    expect(int.indexOf("tests/acceptance/H3a/")).toBe(int.indexOf("tests/acceptance/H2c/") + 1);
    expect(a.at(-1)).toEqual(c.at(-1) as (typeof a)[number]);
  });

  it("stack H3a chặn, ngay sau stack H2c (sau mọi stack cũ)", () => {
    const i = titles.indexOf("bun run test:h3a:stack");
    expect(i).toBe(titles.indexOf("bun run test:h2c:stack") + 1);
    expect(a[i]?.blocking).toBe(true);
  });
});

describe("MK H3a · script + bunfig + .gitignore", () => {
  it("done:h3a, test:h3a:stack (bunfig.stack, đường dẫn stack)", () => {
    expect(pkg.scripts["done:h3a"]).toBe("bun --env-file=.env.local tools/scripts/src/done-h3a.ts");
    const stack = pkg.scripts["test:h3a:stack"] ?? "";
    expect(stack).toContain("--config=bunfig.stack.toml");
    expect(stack.endsWith("tests/acceptance/H3a/stack")).toBe(true);
  });

  it("bunfig.toml + bunfig.int.toml bỏ H3a/stack; .gitignore có .data/", () => {
    for (const f of ["bunfig.toml", "bunfig.int.toml"])
      expect(read(f)).toContain('"tests/acceptance/H3a/stack/**"');
    expect(read(".gitignore").split(/\r?\n/)).toContain(".data/");
  });
});
