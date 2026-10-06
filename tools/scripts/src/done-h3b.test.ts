// HUB-H3b · HUB-FR-78 · `done:h3b` (test-plan H3b §7): mọi bước `done:h3a` giữ thứ tự + phần H3b; script/bunfig MK.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h3aSteps } from "./done-h3a";
import { h3bSteps } from "./done-h3b";

const ROOT = join(import.meta.dir, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

const p = h3aSteps({});
const b = h3bSteps({});

describe("HUB-H3b · done:h3b", () => {
  it("cùng số bước và thứ tự với done:h3a; bước khác chỉ là unit/int", () => {
    expect(b).toHaveLength(p.length);
    b.forEach((s, i) => {
      const o = p[i] as (typeof p)[number];
      if (/^bun (test |--env-file=\.env\.local --config=bunfig\.int)/.test(o.title))
        expect(s.title.startsWith(o.title.split(" tests/")[0] as string)).toBe(true);
      else expect(s).toEqual(o);
    });
  });

  it("unit có H3b/rules; int có H3b/ ngay sau H3a/; không quét H3b-cmd", () => {
    const unit = b.find((s) => s.title.startsWith("bun test "));
    expect(unit?.argv.at(-1)).toBe("tests/acceptance/H3b/rules");
    const int = b.find((s) => s.title.includes("--config=bunfig.int.toml"))?.argv ?? [];
    expect(int.indexOf("tests/acceptance/H3b/")).toBe(int.indexOf("tests/acceptance/H3a/") + 1);
    for (const s of b) expect(s.argv.join(" ")).not.toContain("H3b-cmd");
    expect(b.at(-1)).toEqual(p.at(-1) as (typeof b)[number]);
  });
});

describe("MK H3b · script + bunfig", () => {
  it("done:h3b trong package.json", () => {
    expect(pkg.scripts["done:h3b"]).toBe("bun --env-file=.env.local tools/scripts/src/done-h3b.ts");
  });

  it("bunfig.toml + bunfig.int.toml bỏ H3b-cmd (AC-13 chạy tay)", () => {
    for (const f of ["bunfig.toml", "bunfig.int.toml"])
      expect(read(f)).toContain('"tests/acceptance/H3b-cmd/**"');
  });
});
