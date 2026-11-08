import { describe, expect, it } from "bun:test";
import { toastIssues } from "./check-toast.rules";

const run = (files: Record<string, string>) => toastIssues(new Map(Object.entries(files)));

describe("check:toast", () => {
  it("import từ gói UI chung ⇒ sạch", () => {
    expect(run({ "apps/a/src/x.ts": 'import { toast } from "@ai/web-kit/ui/toast";' })).toEqual([]);
  });
  it("import sonner trong app ⇒ vi phạm (tĩnh và lười)", () => {
    const bad = run({
      "apps/a/src/x.ts": 'import { toast } from "sonner";',
      "apps/b/src/y.ts": 'const m = await import("sonner");',
    });
    expect(bad.map((i) => i.file)).toEqual(["apps/a/src/x.ts", "apps/b/src/y.ts"]);
    expect(bad[0]?.line).toBe(1);
  });
  it("trong packages/web-kit được phép", () => {
    expect(run({ "packages/web-kit/src/ui/toast.tsx": 'import("sonner")' })).toEqual([]);
  });
});
