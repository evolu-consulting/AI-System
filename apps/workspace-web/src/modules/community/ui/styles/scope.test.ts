// CR-118 · CSS Community không rò sang module khác: mọi quy tắc nằm dưới data-mod community, biến riêng --cm-*.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

const dir = import.meta.dir;
const files = readdirSync(dir).filter((f) => f.endsWith(".css") && f !== "community.css");

describe("CSS Community scoped", () => {
  it("mọi selector có tiền tố data-mod community và biến chỉ --cm hoặc --lg", () => {
    const bad: string[] = [];
    for (const f of files) {
      const root = postcss.parse(readFileSync(join(dir, f), "utf8"));
      root.walkRules((r) => {
        if (r.parent?.type === "atrule" && /keyframes$/.test((r.parent as postcss.AtRule).name))
          return;
        for (const s of r.selectors)
          if (!s.trim().startsWith('[data-mod="community"]')) bad.push(`${f}: ${s}`);
      });
      root.walkDecls((d) => {
        if (d.prop.startsWith("--") && !/^--(cm|lg)-/.test(d.prop)) bad.push(`${f}: ${d.prop}`);
      });
    }
    expect(files.length).toBeGreaterThan(3);
    expect(bad).toEqual([]);
  });
});
