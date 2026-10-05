// WRK-FR-15 · HUB-H2b-AC-08 (vế Hub) · H2b-R27 · plan P15 · plan-errors §2, §4 · test-plan H2b §5, cases §2 A130–A132:
// `job.failed{UPSTREAM_ERROR, reason: refused}` (F4, Runtime phân loại `is_error` 0 token) → `run.failed UPSTREAM_ERROR`,
// `message` = câu `UPSTREAM_ERROR` H1, `hint` riêng theo locale của run (`runErrorTextFor`) — cả run `direct` lẫn job
// Orchestrator; reason khác/`null` giữ câu H1. Không thêm mã `run.failed` (T14).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { ChatRunErrorCode } from "@ai/contracts/chat";
import type { HubJobErrorCode, JobFailReason } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { runErrorText } from "../../../apps/hub-api/src/modules/runs/run-errors";
import { type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { type HubX, runRow, testRedis } from "../H1/_hub";
import type { Job } from "../H1/_runtime";
import { ScriptRuntime3, settleRuns, setupH2b, startHubH2b } from "./_h2b";
import { type Run, startRun } from "./_stream";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime3;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime3(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

/** plan-errors §2 — nguyên văn. */
const REFUSED_HINT = {
  vi: "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.",
  en: "The request could not be handled — rephrase or split it.",
} as const;
type Who = "lan" | "hoa";

const start = async (who: Who, content: string): Promise<Run> =>
  startRun(hub, sql, await sign(k, USERS[who]), { who, content });
async function nextAs(x: Run, role: "orchestrator" | "agent"): Promise<Job> {
  const job = await rt.next(x.runId);
  expect(job.payload.agent.role).toBe(role);
  return job;
}
async function failedWith(
  x: Run,
  job: Job,
  f: { code: HubJobErrorCode; reason: JobFailReason | null },
): Promise<Json> {
  await rt.fail(job, f.code, "upstream said no", f.reason);
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end?.event).toBe("run.failed");
  return end?.data;
}
/** `run.failed` + hàng `runs` mang đúng `{code, message, hint}`. */
async function expectRunError(
  x: Run,
  data: Json,
  want: { code: ChatRunErrorCode; message: string; hint: string },
): Promise<void> {
  expect({ code: data?.code, message: data?.message, hint: data?.hint }).toEqual(want);
  expect(await runRow(sql, x.runId)).toMatchObject({
    error_code: want.code,
    error_message: want.message,
    error_hint: want.hint,
  });
}
const refusedText = (who: Who) => ({
  code: "UPSTREAM_ERROR" as const,
  message: runErrorText("UPSTREAM_ERROR", USERS[who].locale).message,
  hint: REFUSED_HINT[USERS[who].locale],
});
const REFUSED = { code: "UPSTREAM_ERROR", reason: "refused" } as const;

describe("A130–A131 · F4 refused → hint riêng [HUB-H2b-AC-08 · H2b-R27]", () => {
  for (const who of ["lan", "hoa"] as const) {
    it(`WRK-FR-15 · A130 · ${who} (${USERS[who].locale}) run direct: job.failed{UPSTREAM_ERROR, refused} → run.failed UPSTREAM_ERROR, message câu H1, hint refused theo locale [HUB-H2b-AC-08 · H2b-R27]`, async () => {
      const x = await start(who, "@assistant Câu bị từ chối A130");
      const job = await nextAs(x, "agent");
      await expectRunError(x, await failedWith(x, job, REFUSED), refusedText(who));
    });

    it(`WRK-FR-15 · A131 · ${who} (${USERS[who].locale}) job Orchestrator refused → như A130 [H2b-R27]`, async () => {
      const x = await start(who, "Câu bị từ chối A131");
      const job = await nextAs(x, "orchestrator");
      await expectRunError(x, await failedWith(x, job, REFUSED), refusedText(who));
    });
  }
});

describe("A132 · reason khác giữ câu H1 [H2b-R27 · T14]", () => {
  for (const c of [
    { code: "UPSTREAM_ERROR", reason: null },
    { code: "UPSTREAM_ERROR", reason: "upstream" },
    { code: "NOT_CONFIGURED", reason: "credential" },
  ] as const) {
    it(`WRK-FR-15 · A132 · lan job Orchestrator ${c.code}/${c.reason ?? "null"} → run.failed ${c.code} với message + hint H1 [H2b-R27]`, async () => {
      const x = await start("lan", `Câu A132 ${c.code} ${c.reason}`);
      const job = await nextAs(x, "orchestrator");
      const h1 = runErrorText(c.code, "vi");
      await expectRunError(x, await failedWith(x, job, c), { code: c.code, ...h1 });
      expect(h1.hint).not.toBe(REFUSED_HINT.vi);
    });
  }
});
