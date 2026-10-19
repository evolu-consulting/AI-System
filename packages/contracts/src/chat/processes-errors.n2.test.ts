// N2-FR-04 · câu 429 hiện trần thật của tenant (`details.max`), thiếu ⇒ mặc định.
import { describe, expect, test } from "bun:test";
import { PROCESS_RUNS_PER_TENANT } from "./processes";
import { processRunsMaxOf } from "./processes-errors";

describe("N2-FR-04 · processRunsMaxOf", () => {
  test("details.max hợp lệ ⇒ dùng; thiếu/sai ⇒ mặc định", () => {
    expect(processRunsMaxOf({ max: 200 })).toBe(200);
    expect(processRunsMaxOf(undefined)).toBe(PROCESS_RUNS_PER_TENANT);
    expect(processRunsMaxOf({ max: 0 })).toBe(PROCESS_RUNS_PER_TENANT);
    expect(processRunsMaxOf({ max: "7" }, 3)).toBe(3);
  });
});
