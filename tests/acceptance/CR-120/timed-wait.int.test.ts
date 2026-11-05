// CR-120 · cr120-contracts-flow · G3 `wait_for` + G4 `wait_event` trên hub THẬT (đồng hồ lệch, vòng hẹn `sweepOnce`):
// (1) chờ N giờ: chưa tới hạn không đổi, tới hạn ⇒ stage done + run chạy tiếp; (2) chờ sự kiện: `signalEvent` thả đúng stage ngay (hẹn hạn huỷ);
// (3) hết hạn không sự kiện ⇒ chạy tiếp, .md "Hết hạn chờ"; (4) sự kiện tới TRƯỚC bước chờ ⇒ vào bước là qua, .md "Đã nhận";
// (5) tenant khác bắn cùng bản ghi gói ⇒ 0 thả, 0 hàng sự kiện; bảng `process_run_events` bật RLS. Khuôn CF `startCf` (cổng `packRuns`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type CtxCf, caller, startCf } from "../CF/_cf";
import { type Json, PA, sweepN, T, timersOf, waitFor } from "../P-d/_support/pd";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const raw = (key: string, step: number, executor: Json, fields: Json[] = []): Json => ({
  key,
  name: key,
  step,
  executor,
  instruction: "",
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 60,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
});
const setStage = (key: string, step: number): Json =>
  raw(key, step, { kind: "set", values: [{ key: "v", from: { const: "x" } }] }, [
    { key: "v", type: "string", required: true },
  ]);

const DEF_KEY = "cr120-timed-wait";
const H = 3_600_000;
let n = 0;
const rid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

async function ensure(): Promise<void> {
  await c.port.ensureDef(
    caller(PA.A),
    DEF_KEY,
    {
      name: "CR-120 timed wait",
      description: "Bộ test G3/G4.",
      input_hint: "x",
      run_group_ids: [],
      stages: [
        setStage("a", 0),
        raw("cho-gio", 1, { kind: "wait_for", hours: 2 }),
        raw("cho-ky", 2, { kind: "wait_event", event: "esign.completed", timeout_h: 48 }),
        setStage("z", 3),
      ],
      token_budget: null,
      enabled: true,
    },
    1,
  );
}
async function open(record: string): Promise<string> {
  const { runId, kick } = await c.port.start(caller(PA.A), {
    process_key: DEF_KEY,
    input: "x",
    ref: { pack: "contracts", record_id: record },
  });
  await kick();
  return runId;
}
const stageRow = async (runId: string, idx: number): Promise<Json> =>
  (
    await c.sql<Json[]>`select status from hub.stage_runs where process_run_id = ${runId}
      and stage_idx = ${idx} order by round desc, attempt desc limit 1`
  )[0] as Json;
const stageIs = (runId: string, idx: number, st: string) =>
  waitFor(
    () => stageRow(runId, idx),
    (r) => r?.status === st,
    15_000,
  );
const runIs = (runId: string, st: string) =>
  waitFor(
    async () =>
      (await c.sql<Json[]>`select status from hub.process_runs where id = ${runId}`)[0] as Json,
    (r) => r?.status === st,
    15_000,
  );
const outputMd = async (runId: string, idx: number): Promise<string> =>
  (
    (
      await c.sql<Json[]>`select content from hub.process_outputs where process_run_id = ${runId}
        and stage_idx = ${idx} order by version desc limit 1`
    )[0] as Json
  )?.content as string;
const openTimers = async (runId: string) =>
  (await timersOf(c.sql, runId)).filter((t) => !t.fired_at && !t.cancelled_at);
/** Đưa run tới stage `cho-ky` đang chờ (qua bước `wait_for` 2 giờ bằng đồng hồ lệch). */
async function toEventWait(record: string): Promise<string> {
  const runId = await open(record);
  await stageIs(runId, 1, "waiting_timer");
  c.clk.advance(2 * H + 1000);
  await sweepN(c);
  await stageIs(runId, 1, "done");
  await stageIs(runId, 2, "waiting_timer");
  return runId;
}

describe("CR-120 · wait_for / wait_event [G3][G4]", () => {
  it("G3 · wait_for 2 h: chưa tới hạn giữ nguyên; tới hạn ⇒ done + chạy tiếp tới bước chờ sự kiện", async () => {
    await ensure();
    const runId = await open(rid());
    await stageIs(runId, 1, "waiting_timer");
    const [t] = await openTimers(runId);
    expect(t).toMatchObject({ kind: "wait_until" });
    c.clk.advance(H); // 1 h < 2 h
    await sweepN(c);
    expect((await stageRow(runId, 1)).status).toBe("waiting_timer");
    c.clk.advance(H + 1000);
    await sweepN(c);
    await stageIs(runId, 1, "done");
    await stageIs(runId, 2, "waiting_timer");
    expect((await openTimers(runId)).length).toBe(1); // hẹn hạn của wait_event
  }, 90_000);

  it("G4 · signalEvent thả đúng stage ngay, huỷ hẹn hạn, ghi .md 'Đã nhận sự kiện', run chạy tiếp tới done", async () => {
    const rec = rid();
    const runId = await toEventWait(rec);
    const released = await c.port.signalEvent(
      T.acme,
      { pack: "contracts", record_id: rec },
      "esign.completed",
    );
    expect(released).toBe(1);
    await stageIs(runId, 2, "done");
    expect((await openTimers(runId)).length).toBe(0);
    expect(await outputMd(runId, 2)).toContain("Đã nhận sự kiện esign.completed.");
    await runIs(runId, "done");
  }, 90_000);

  it("G4 · hết hạn 48 h không sự kiện ⇒ chạy tiếp, .md 'Hết hạn chờ'", async () => {
    const runId = await toEventWait(rid());
    c.clk.advance(48 * H + 1000);
    await sweepN(c);
    await stageIs(runId, 2, "done");
    expect(await outputMd(runId, 2)).toContain("Hết hạn chờ sự kiện esign.completed");
    await runIs(runId, "done");
  }, 90_000);

  it("G4 · sự kiện tới TRƯỚC bước chờ ⇒ chỉ ghi (0 thả); tới bước là qua, .md 'Đã nhận'", async () => {
    const rec = rid();
    const runId = await open(rec);
    await stageIs(runId, 1, "waiting_timer");
    expect(
      await c.port.signalEvent(T.acme, { pack: "contracts", record_id: rec }, "esign.completed"),
    ).toBe(0);
    c.clk.advance(2 * H + 1000);
    await sweepN(c); // wait_for xong ⇒ cho-ky vào chờ với hẹn tới hạn ngay
    await stageIs(runId, 2, "waiting_timer");
    await sweepN(c);
    await stageIs(runId, 2, "done");
    expect(await outputMd(runId, 2)).toContain("Đã nhận sự kiện esign.completed.");
    await runIs(runId, "done");
  }, 90_000);

  it("tenant khác bắn cùng bản ghi ⇒ 0 thả, 0 hàng sự kiện; sự kiện sai dạng ⇒ 0; bảng sự kiện bật RLS", async () => {
    const rec = rid();
    const runId = await toEventWait(rec);
    expect(
      await c.port.signalEvent(T.beta, { pack: "contracts", record_id: rec }, "esign.completed"),
    ).toBe(0);
    expect(
      await c.port.signalEvent(T.acme, { pack: "contracts", record_id: rec }, "BAD EVENT"),
    ).toBe(0);
    const [e] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_run_events
      where process_run_id = ${runId}`;
    expect(e?.n).toBe(0);
    expect((await stageRow(runId, 2)).status).toBe("waiting_timer");
    const [rls] = await c.sql<{ on: boolean }[]>`select relrowsecurity as on from pg_class
      where oid = 'hub.process_run_events'::regclass`;
    expect(rls?.on).toBe(true);
  }, 90_000);
});
