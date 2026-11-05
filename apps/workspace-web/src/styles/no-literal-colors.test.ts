// CR-120 · Chặn màu cứng: CSS dưới modules/**/styles chỉ dùng token của shell (globals.css, có bản sáng + tối).
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const modulesDir = join(import.meta.dir, "..", "modules");
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch)\(/g;

function cssUnderStyles(dir: string, inStyles = false): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssUnderStyles(p, inStyles || name === "styles"));
    else if (inStyles && name.endsWith(".css")) out.push(p);
  }
  return out;
}

describe("CSS module không có màu cứng", () => {
  it("không hex/rgb/hsl literal dưới modules/**/styles (dùng token globals.css)", () => {
    const files = cssUnderStyles(modulesDir);
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      text.split("\n").forEach((line, i) => {
        if (LITERAL.test(line))
          bad.push(`${f.slice(modulesDir.length + 1)}:${i + 1}: ${line.trim()}`);
        LITERAL.lastIndex = 0;
      });
    }
    expect(files.length).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });

  it("globals.css có bản sáng và tối cho màu thương hiệu Community", () => {
    const css = readFileSync(join(import.meta.dir, "globals.css"), "utf8");
    for (const b of ["blue", "teal", "green", "orange", "rose"])
      expect(css.match(new RegExp(`--brand-${b}:`, "g"))?.length).toBe(2);
  });
});
