import { describe, expect, it } from "bun:test";
import { nativeDateIssues, SHARED_DATE_INPUT } from "./check-date-input.rules";

const run = (files: Record<string, string>) => nativeDateIssues(new Map(Object.entries(files)));

describe("check:date-input", () => {
  it("bắt type=date và datetime-local trong .tsx", () => {
    const r = run({
      "apps/a/X.tsx": '<input\n  type="date"\n/>\n<input type="datetime-local" />',
      "apps/a/Y.tsx": "<input type={'date'} />",
    });
    expect(r.map((i) => `${i.file}:${i.line}`)).toEqual([
      "apps/a/X.tsx:2",
      "apps/a/X.tsx:4",
      "apps/a/Y.tsx:1",
    ]);
  });
  it("bỏ qua component chung, test, .ts và type khác", () => {
    expect(
      run({
        [SHARED_DATE_INPUT]: '<input type="date" />',
        "apps/a/X.test.tsx": '<input type="date" />',
        "apps/a/z.ts": 'const x = { type: "date" }',
        "apps/a/T.tsx": '<input type="text" /><DateInput />',
      }),
    ).toEqual([]);
  });
});
