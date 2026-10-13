// HUB-FR-133 · HUB-FR-134 · K1-AC05 · K1-AC06 · K1-AC07 · CR-073 · spec §2 (Ghi worklog, `## Tóm tắt`), §3.0 (`/vector/add`), §3.4
// (đích chốt lúc start, ghi khi done, thử lại), §4 (`snapshot.kh`, `kh_writes`) · plan §3.5, D8, D10 · test-plan K1 §4 A60–A71:
// đích = KH đầu tiên (thứ tự tick, dùng được) có summary_project ⇒ `snapshot.kh` + "Tóm tắt" bắt buộc; không có / stage nhóm ⇒
// không; auto / gate Đạt ⇒ `kh_writes` + `POST /vector/add` id cố định `kw-<run>-<stage_run>-v<n>` (idempotent); gate chờ/trượt
// ⇒ không; lỗi ⇒ thử lại ≤ 5 / 4xx ⇒ failed + audit `write_fail`; kết nối hết dùng được ⇒ skipped. Không đổi trạng thái run.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  CONN,
  type CtxK1,
  K1,
  khWriteOnce,
  MD_NOSUM,
  mdSum,
  needK1,
  P1,
  PROJ,
  SUM_TEXT,
  seedFull,
  setStatus,
  startK1,
  T,
  tick,
} from "./_k1";
import {
  decide,
  dueNow,
  finish,
  promptOf,
  runRow,
  settle,
  stageJob,
  stageRow,
  startRun,
  viewOf,
  waitStage,
  writesOf,
} from "./_run";

let c: CtxK1;
beforeAll(async () => {
  c = await startK1({ seed: "full" });
}, 90_000);
afterAll(async () => {
  await c?.stop();
});
beforeEach(async () => {
  c.khA.reset();
  c.khB.reset();
  if (!c.k1 || !c.sec) return;
  await settle(c.sql);
  await c.sql`update hub.kh_writes set status = 'done' where status = 'pending'`;
  await seedFull(c);
});

const need = () => needK1(c);
const TARGET = { connection_id: K1.connMain, name: CONN.main, project: PROJ.a };
const defStages = async (key: string) =>
  (await c.sql`select stages from hub.process_defs where key = ${key} and tenant_id = ${T.acme}`)[0]
    ?.stages;
const sections = (s: { output: { required_sections: string[] } }) => s.output.required_sections;
const adds = () => [...c.khA.callsTo("/vector/add"), ...c.khB.callsTo("/vector/add")];
const knowledge = async (runId: string, idx: number) =>
  (await viewOf(c, "A", runId)).json?.stages?.[idx]?.knowledge;
async function doneStage0(key = "k1-auto", md = mdSum()): Promise<string> {
  const runId = await startRun(c, key);
  await finish(c, runId, 0, md);
  await waitStage(c.sql, runId, 0, "done");
  return runId;
}

describe("A60–A62 · đích `## Tóm tắt` chốt lúc start [K1-AC07 · spec §3.4 · Q8]", () => {
  it("HUB-FR-133 · K1-AC07 · A60 · KH đầu có summary_project ⇒ snapshot.kh mọi stage agent = {kết nối, project}; snapshot bắt buộc 'Tóm tắt'; def gốc không đổi; prompt nhắc '## Tóm tắt'", async () => {
    need();
    const runId = await startRun(c, "k1-auto");
    const r = await runRow(c.sql, runId);
    expect(r?.snapshot?.kh).toEqual({ stages: [TARGET, TARGET] });
    for (const s of r?.snapshot?.stages ?? []) expect(sections(s)).toContain("Tóm tắt");
    for (const s of await defStages("k1-auto")) expect(sections(s)).not.toContain("Tóm tắt");
    const j = await stageJob(c, runId, 0);
    expect(promptOf(j)).toContain("## Tóm tắt");
  });
  it("HUB-FR-133 · K1-AC07 · Q34 · A61 · không KH nào có summary_project / KH có nhưng không dùng được ⇒ không đích, snapshot = def, prompt không nhắc; trộn ⇒ chỉ stage có đích", async () => {
    need();
    await tick(c.sql, P1.agRead, [K1.connAlt]);
    await tick(c.sql, P1.agPost, [K1.connAlt]);
    const a = await startRun(c, "k1-auto");
    const ra = await runRow(c.sql, a);
    expect(ra?.snapshot?.kh ?? null).toBeNull();
    expect(ra?.snapshot?.stages).toEqual(await defStages("k1-auto"));
    expect(promptOf(await stageJob(c, a, 0))).not.toContain("## Tóm tắt");
    await settle(c.sql);
    await tick(c.sql, P1.agPost, [K1.connAlt, K1.connMain]);
    const b = await startRun(c, "k1-auto");
    const rb = await runRow(c.sql, b);
    expect(rb?.snapshot?.kh).toEqual({ stages: [null, TARGET] });
    expect(sections(rb?.snapshot?.stages?.[0])).not.toContain("Tóm tắt");
    expect(sections(rb?.snapshot?.stages?.[1])).toContain("Tóm tắt");
    await settle(c.sql);
    await tick(c.sql, P1.agRead, [K1.connMain]);
    await setStatus(c.sql, K1.connMain, "error");
    const d = await startRun(c, "k1-auto");
    expect((await runRow(c.sql, d))?.snapshot?.kh ?? null).toBeNull();
  });
  it("HUB-FR-133 · Q8 · A62 · stage nhóm agent ⇒ không đích dù thành viên tick KH có summary_project", async () => {
    need();
    for (const a of [P1.agM1, P1.agM2, P1.agM3]) await tick(c.sql, a, [K1.connMain]);
    const runId = await startRun(c, "p-team");
    const r = await runRow(c.sql, runId);
    expect(r?.snapshot?.kh ?? null).toBeNull();
    expect(sections(r?.snapshot?.stages?.[0])).not.toContain("Tóm tắt");
  });
});

describe("A63–A67 · ghi Tóm tắt [K1-AC05 · spec §3.0 · Q32]", () => {
  it("HUB-FR-133 · K1-AC05 · A63 · auto chốt output ⇒ kh_writes pending; khWriteOnce ⇒ POST /vector/add (X-KH-Key) đúng body + id kw-<run>-<stage_run>-v1 ⇒ done; view pending → written", async () => {
    need();
    const runId = await doneStage0();
    const sr = await stageRow(c.sql, runId, 0);
    const vid = `kw-${runId}-${sr?.id}-v1`;
    const w = await writesOf(c.sql, runId);
    expect(
      w.map((x) => [x.status, x.connection_id, x.project_id, x.subject, x.body, x.vector_id]),
    ).toEqual([["pending", K1.connMain, PROJ.a, "k1-auto/a0", SUM_TEXT, vid]]);
    expect((await knowledge(runId, 0))?.summary).toBe("pending");
    expect(await khWriteOnce(c)).toBeGreaterThanOrEqual(1);
    const add = c.khA.callsTo("/vector/add");
    expect(add.map((x) => [x.via, x.keyOk, x.status])).toEqual([["x-kh-key", true, 200]]);
    expect(add[0]?.body).toEqual({
      id: vid,
      text: SUM_TEXT,
      scope: "log",
      metadata: {
        scope: "log",
        project: PROJ.a,
        subject: "k1-auto/a0",
        topic: "k1-auto/a0",
        ts: expect.any(String),
        source: "ai-hub",
      },
    });
    expect(c.khA.vectors.get(vid)?.text).toBe(SUM_TEXT);
    expect((await writesOf(c.sql, runId)).map((x) => x.status)).toEqual(["done"]);
    expect((await knowledge(runId, 0))?.summary).toBe("written");
    expect(c.khB.calls).toEqual([]);
  });
  it("HUB-FR-133 · K1-AC05 · A64 · gate: chờ duyệt ⇒ chưa ghi; Chưa đạt ⇒ không ghi; làm lại + Đạt ⇒ đúng 1 hàng, id theo phiên bản output hiện tại (v2)", async () => {
    need();
    const runId = await startRun(c, "k1-gate");
    await finish(c, runId, 0, mdSum("TOM-TAT-V1"));
    await waitStage(c.sql, runId, 0, "waiting_review");
    expect(await writesOf(c.sql, runId)).toEqual([]);
    await decide(c, runId, 0, { result: "fail", feedback: "Thiếu số liệu" });
    expect(await writesOf(c.sql, runId)).toEqual([]);
    await finish(c, runId, 0, mdSum("TOM-TAT-V2"));
    await decide(c, runId, 0, { result: "pass" });
    await waitStage(c.sql, runId, 0, "done");
    const sr = await stageRow(c.sql, runId, 0);
    const w = await writesOf(c.sql, runId);
    expect(w.map((x) => [x.subject, x.body, x.vector_id])).toEqual([
      ["k1-gate/g0", "TOM-TAT-V2", `kw-${runId}-${sr?.id}-v2`],
    ]);
  });
  it("HUB-FR-133 · K1-AC05 · A65 · stage không có đích ⇒ không hàng, KH không nhận /vector/add", async () => {
    need();
    await tick(c.sql, P1.agRead, [K1.connAlt]);
    const runId = await doneStage0("k1-auto", MD_NOSUM);
    expect(await writesOf(c.sql, runId)).toEqual([]);
    await khWriteOnce(c);
    expect(adds()).toEqual([]);
    expect((await knowledge(runId, 0))?.write_to ?? null).toBeNull();
  });
  it("HUB-FR-133 · Q32 · A66 · gửi lại cùng hàng ⇒ cùng id, KH upsert còn 1 vector (2 lần ghi), hàng done", async () => {
    need();
    const runId = await doneStage0();
    await khWriteOnce(c);
    await c.sql`update hub.kh_writes set status = 'pending', next_at = now() - interval '1 second' where process_run_id = ${runId}`;
    await khWriteOnce(c);
    const posts = c.khA.callsTo("/vector/add");
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((p) => p.body?.id)).size).toBe(1);
    expect(c.khA.vectors.size).toBe(1);
    expect([...c.khA.vectors.values()][0]?.writes).toBe(2);
    expect((await writesOf(c.sql, runId)).map((w) => w.status)).toEqual(["done"]);
  });
  it("HUB-FR-133 · A67 · Tóm tắt > 200 từ ⇒ text gửi ≤ 200 từ, ≤ 4000 ký tự", async () => {
    need();
    const long = Array.from({ length: 260 }, (_, i) => `tu${i}`).join(" ");
    const runId = await doneStage0("k1-auto", mdSum(long));
    await khWriteOnce(c);
    const text = String(c.khA.callsTo("/vector/add")[0]?.body?.text ?? "");
    expect(text.startsWith("tu0 tu1")).toBe(true);
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(200);
    expect(text.length).toBeLessThanOrEqual(4000);
    expect(text).not.toContain("tu200");
    expect((await writesOf(c.sql, runId))[0]?.body).toBe(text);
  });
});

describe("A68–A71 · KH lỗi khi ghi [HUB-FR-134 · K1-AC06]", () => {
  it("HUB-FR-134 · K1-AC06 · A68 · 500 ⇒ pending attempts 1, next_at lùi ≥ ~30 s, last_code; run vẫn chạy (stage 1 có job)", async () => {
    need();
    c.khA.set({ scenario: "server_error" });
    const runId = await doneStage0();
    await khWriteOnce(c);
    const [w] = await writesOf(c.sql, runId);
    expect([w?.status, w?.attempts]).toEqual(["pending", 1]);
    expect(new Date(w?.next_at).getTime() - Date.now()).toBeGreaterThan(25_000);
    expect(String(w?.last_code ?? "")).not.toBe("");
    expect((await stageJob(c, runId, 1)).id).toBeTruthy();
  });
  it("HUB-FR-134 · K1-AC06 · A69 · hết 5 lần ⇒ failed + audit write_fail kh_worklog {attempts 5}; view summary failed", async () => {
    need();
    c.khA.set({ scenario: "rate_limited" });
    const runId = await doneStage0();
    const a0 = await auditMaxK1(c.sql);
    for (let i = 0; i < 6; i++) {
      await dueNow(c.sql);
      await khWriteOnce(c);
    }
    const [w] = await writesOf(c.sql, runId);
    expect([w?.status, w?.attempts]).toEqual(["failed", 5]);
    expect(c.khA.callsTo("/vector/add")).toHaveLength(5);
    const au = await auditSinceK1(c.sql, a0, "kh_worklog");
    expect(au.map((x) => [x.action, x.tenant_id, x.summary?.attempts])).toEqual([
      ["write_fail", T.acme, 5],
    ]);
    expect((await knowledge(runId, 0))?.summary).toBe("failed");
  });
  it("HUB-FR-134 · A70 · 403 ⇒ failed ngay (không thử lại) + audit write_fail", async () => {
    need();
    c.khA.set({ scenario: "forbidden" });
    const runId = await doneStage0();
    const a0 = await auditMaxK1(c.sql);
    await khWriteOnce(c);
    await dueNow(c.sql);
    await khWriteOnce(c);
    expect((await writesOf(c.sql, runId)).map((w) => w.status)).toEqual(["failed"]);
    expect(c.khA.callsTo("/vector/add")).toHaveLength(1);
    expect((await auditSinceK1(c.sql, a0, "kh_worklog")).map((x) => x.action)).toEqual([
      "write_fail",
    ]);
  });
  it("HUB-FR-133 · Q34 · A71 · kết nối hết dùng được trước khi gửi ⇒ skipped + audit write_fail {code: disabled}; KH không nhận; run không đổi", async () => {
    need();
    const runId = await doneStage0();
    await setStatus(c.sql, K1.connMain, "error");
    const a0 = await auditMaxK1(c.sql);
    const before = (await runRow(c.sql, runId))?.status;
    await khWriteOnce(c);
    expect((await writesOf(c.sql, runId)).map((w) => w.status)).toEqual(["skipped"]);
    expect(adds()).toEqual([]);
    const au = await auditSinceK1(c.sql, a0, "kh_worklog");
    expect(au.map((x) => [x.action, x.summary?.code])).toEqual([["write_fail", "disabled"]]);
    expect((await runRow(c.sql, runId))?.status).toBe(before);
    expect((await knowledge(runId, 0))?.summary).toBe("skipped");
  });
});
