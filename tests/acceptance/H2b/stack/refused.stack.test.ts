// WRK-FR-15 · HUB-H2b-AC-08 · H2b-R27 · test-plan-py §3 S08: stack thật — `@assistant #fake:is-error=refused` (PY-04,
// L2): Runtime phân loại `is_error` 0 token → `job.failed{UPSTREAM_ERROR, refused}` (PY-03 F4) → Hub `run.failed
// UPSTREAM_ERROR` + hint `refused` theo locale (B11, plan-errors §2); chữ result không lộ ra SSE.
// Chạy: bun run test:h2b:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { runErrorText } from "../../../../apps/hub-api/src/modules/runs/run-errors";
import { bootStackH2b, endOf, type StackH2b, settleStack, stackRun } from "./_stack";

const RT = "qc-h2b-stack-refused";
/** plan-errors §2 — nguyên văn (vi, `lan`). */
const REFUSED_HINT_VI = "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.";
const REFUSED_TEXT = "I can't help with that.";
let st: StackH2b;
beforeAll(async () => {
  st = await bootStackH2b(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  await st?.stop();
});

describe("S08 · F4 refused end-to-end [HUB-H2b-AC-08 · H2b-R27]", () => {
  it("WRK-FR-15 · S08 · '@assistant #fake:is-error=refused x' → run.failed UPSTREAM_ERROR, message câu H1, hint refused; chữ result không trong SSE [HUB-H2b-AC-08 · H2b-R27]", async () => {
    const x = await stackRun(st, "@assistant #fake:is-error=refused x S08");
    const data = await endOf(x, "run.failed");
    expect({ code: data?.code, message: data?.message, hint: data?.hint }).toEqual({
      code: "UPSTREAM_ERROR",
      message: runErrorText("UPSTREAM_ERROR", "vi").message,
      hint: REFUSED_HINT_VI,
    });
    expect(JSON.stringify(x.s.events)).not.toContain(REFUSED_TEXT);
    const [job] = await st.sql<{ error_code: string; error_reason: string }[]>`
      select error_code, error_reason from hub.jobs where run_id = ${x.runId}`;
    expect(job).toEqual({ error_code: "UPSTREAM_ERROR", error_reason: "refused" });
  }, 120_000);
});
