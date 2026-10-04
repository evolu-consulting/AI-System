// HUB-H2a-AC-12 · `done:h2a`: bước đúng test-plan H2a §7.1, thứ tự, kế thừa done:h1.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h2aSteps } from "./done-h2a";

const PLAN = readFileSync(
  join(import.meta.dir, "../../../docs/specs/H2a-dify-command/test-plan.md"),
  "utf8",
);
const block71 = (() => {
  const sec = PLAN.slice(PLAN.indexOf("### 7.1"), PLAN.indexOf("### 7.2"));
  const code = sec.slice(sec.indexOf("```") + 3, sec.lastIndexOf("```"));
  return code
    .replace(/\\\n\s*/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+#.*$/, "").trim())
    .map((l) => l.replace("uv sync --frozen && ", ""))
    .filter(Boolean);
})();

describe("HUB-H2a-AC-12 · done:h2a", () => {
  const steps = h2aSteps({});

  it("mọi bước chặn có nguyên văn trong §7.1 (dòng `&&` tách bước), đúng thứ tự", () => {
    const flat = block71.flatMap((l) =>
      l.startsWith("bun run test:h1:stack") || l.startsWith("bun run test:lock")
        ? l.split(" && ")
        : [l],
    );
    const titles = steps.filter((s) => s.blocking).map((s) => s.title.replace(/\s+/g, " "));
    expect(titles).toEqual(flat.map((l) => l.replace(/\s+/g, " ")));
  });

  it("bước chỉ báo cáo đứng cuối, không chặn", () => {
    expect(steps.filter((s) => !s.blocking).map((s) => s.title)).toEqual([
      "tsc -p tsconfig.tests.json",
      "bun run test:perf tests/acceptance/H2a",
    ]);
  });
});
