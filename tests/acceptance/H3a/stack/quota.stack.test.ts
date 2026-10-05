// AC-W02 · WRK-FR-15 · WRK-FR-22 · HUB-H3a-AC-04/05/09 · test-plan-py §3 S01–S04: stack thật — job Orchestrator
// `#fake:ratelimit=<ts>` ⇒ Runtime `cooldown` + `job.failed{ALL_PROVIDERS_EXHAUSTED, quota}` ⇒ Hub `run.failed` câu R08
// (≤ 5 s, AC-W02); 1 job, attempts 1 (AC-05); tin kế bị chặn trước enqueue (AC-04); hết hạn ⇒ probe (file vắng ⇒ `ok`)
// đưa về `ok`, tin kế `run.finished` (AC-09 đầu-cuối). Chạy: bun run test:h3a:stack
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { waitFor } from "../../H1/_fixtures";
import { endOf, type StackH2b, settleStack, stackRun } from "../../H2b/stack/_stack";
import { R08 } from "../_r08";
import { bootStackH3a, jobsOfRunS, providerRow, resetProviderStack } from "./_stack";

const RT = "qc-h3a-stack-quota";
let st: StackH2b;
let firstRun = "";
beforeAll(async () => {
  st = await bootStackH3a(RT);
}, 240_000);
afterEach(() => settleStack(st));
afterAll(async () => {
  if (st) await resetProviderStack(st.sql);
  await st?.stop();
});

describe("S01–S04 · hết quota đầu-cuối [AC-W02 · HUB-H3a-AC-04 · HUB-H3a-AC-05 · HUB-H3a-AC-09]", () => {
  it("AC-W02 · S01 · lan gửi '#fake:ratelimit=<now+1 h>' → run.failed ALL_PROVIDERS_EXHAUSTED + câu quota (vi) ≤ 5 s; provider cooldown = ts [H3a-R01 · H3a-R02 · H3a-R08]", async () => {
    const ts = Math.floor(Date.now() / 1000) + 3600;
    const t0 = Date.now();
    const x = await stackRun(st, `#fake:ratelimit=${ts} S01`);
    const data = await endOf(x, "run.failed", 30_000);
    const ms = Date.now() - t0;
    console.info(`[H3a S01] gửi → run.failed ${ms} ms`);
    firstRun = x.runId;
    expect({ code: data?.code, message: data?.message, hint: data?.hint }).toEqual({
      code: "ALL_PROVIDERS_EXHAUSTED",
      ...R08.quota.vi,
    });
    expect(ms).toBeLessThanOrEqual(5_000);
    const p = await providerRow(st.sql);
    expect(p?.status).toBe("cooldown");
    expect(p?.cooldown_until?.getTime()).toBe(ts * 1000);
  }, 60_000);

  it("WRK-FR-15 · S02 · run S01: đúng 1 job, attempts 1, failed, reason quota (không thử lại) [H3a-R07 · HUB-H3a-AC-05]", async () => {
    expect(firstRun).not.toBe("");
    expect(await jobsOfRunS(st.sql, firstRun)).toEqual([
      {
        status: "failed",
        attempts: 1,
        error_code: "ALL_PROVIDERS_EXHAUSTED",
        error_reason: "quota",
      },
    ]);
  }, 30_000);

  it("WRK-FR-15 · S03 · tin thường kế khi cooldown → run.failed câu quota ≤ 3 s, 0 job mới; run S01 vẫn 1 job [H3a-R06 · H3a-R09 · HUB-H3a-AC-04]", async () => {
    const t0 = Date.now();
    const x = await stackRun(st, "Tin thường S03");
    const data = await endOf(x, "run.failed", 10_000);
    const ms = Date.now() - t0;
    console.info(`[H3a S03] chặn → run.failed ${ms} ms`);
    expect({ code: data?.code, message: data?.message, hint: data?.hint }).toEqual({
      code: "ALL_PROVIDERS_EXHAUSTED",
      ...R08.quota.vi,
    });
    expect(ms).toBeLessThanOrEqual(3_000);
    expect(await jobsOfRunS(st.sql, x.runId)).toEqual([]);
    expect((await jobsOfRunS(st.sql, firstRun)).length).toBe(1);
  }, 30_000);

  it("WRK-FR-22 · S04 · cooldown hết hạn sau 2 s → probe (file vắng ⇒ ok) đưa về ok; tin kế run.finished [H3a-R13 · HUB-H3a-AC-09]", async () => {
    await st.sql`update hub.provider_state set cooldown_until = now() + interval '2 seconds'
      where provider_key = 'fake-cli'`;
    const [row] = await st.sql<{ mark: Date }[]>`select now() as mark`;
    const mark = row?.mark ?? new Date();
    const p = await waitFor(
      () => providerRow(st.sql),
      (r) => r?.status === "ok" && !!r.last_probe_at && r.last_probe_at >= mark,
      20_000,
    );
    expect(p?.status).toBe("ok");
    const x = await stackRun(st, "Tin thường S04");
    await endOf(x, "run.finished", 60_000);
  }, 60_000);
});
