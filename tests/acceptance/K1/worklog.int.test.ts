// HUB-FR-133 · HUB-FR-134 · K1-AC05 · K1-AC06 · K1-AC07 · spec §3.5 (ghi `## Tóm tắt`, `## Tóm tắt` bắt buộc lúc start) + plan
// §3.5–3.6, D5–D7 · test-plan K1 §4 A90–A101: snapshot.kh + ensureSummary chỉ cho quy trình có project (def gốc không đổi);
// hàng chờ `kh_writes` khi stage done (auto / gate Đạt), không khi gate trượt / project chỉ đọc; bộ gửi (`khWriteOnce`, seam G2)
// gọi `POST /v1/{ns}/worklog` đúng subject + Idempotency-Key; KH lỗi ⇒ thử lại có trần ⇒ failed + audit, run không đổi.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMaxK1,
  auditSinceK1,
  type CtxK1,
  khWriteOnce,
  mdSum,
  NS,
  PROJ,
  SUM_TEXT,
  startK1,
  T,
} from "./_k1";
import {
  decide,
  dueNow,
  finish,
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
  if (!c.k1 || !c.sec) return;
  await settle(c.sql);
  await c.sql`update hub.kh_writes set status = 'done' where status = 'pending'`;
  c.kh.reset();
  c.kh.set(NS.acme, { scenario: "ok" });
});

const need = () =>
  expect({ migration0029: c.k1, hubSecrets: c.sec }).toEqual({
    migration0029: true,
    hubSecrets: true,
  });
const defStages = async (key: string) =>
  (await c.sql`select stages from hub.process_defs where key = ${key} and tenant_id = ${T.acme}`)[0]
    ?.stages;
const sections = (s: { output: { required_sections: string[] } }) => s.output.required_sections;

describe("A90–A92 · `## Tóm tắt` bắt buộc chỉ với quy trình có project [K1-AC07 · D5]", () => {
  it("HUB-FR-133 · K1-AC07 · A90 · k1-auto: snapshot.kh mọi stage {proj-a, summary}; snapshot thêm 'Tóm tắt' + template; def gốc không đổi; prompt nhắc Tóm tắt", async () => {
    need();
    const runId = await startRun(c, "k1-auto");
    const r = await runRow(c.sql, runId);
    const sum = { project: PROJ.a, read_only: false, summary: true };
    expect(r?.snapshot?.kh).toEqual({ stages: [sum, sum] });
    for (const s of r?.snapshot?.stages ?? []) {
      expect(sections(s)).toEqual(["Bảng ý", "Tổng tiền", "Tóm tắt"]);
      expect(String(s.output.template).endsWith("## Tóm tắt\n")).toBe(true);
    }
    for (const s of await defStages("k1-auto"))
      expect(sections(s)).toEqual(["Bảng ý", "Tổng tiền"]);
    const j = await stageJob(c, runId, 0);
    expect(String((j.payload as { prompt?: string }).prompt ?? "")).toContain("Tóm tắt");
  });
  it("HUB-FR-133 · K1-AC07 · A91 · quy trình không gắn (k1-none) ⇒ snapshot không có kh, stages = def; prompt không nhắc Tóm tắt", async () => {
    need();
    const runId = await startRun(c, "k1-none");
    const r = await runRow(c.sql, runId);
    expect(r?.snapshot?.kh).toBeUndefined();
    expect(r?.snapshot?.stages).toEqual(await defStages("k1-none"));
    const j = await stageJob(c, runId, 0);
    expect(String((j.payload as { prompt?: string }).prompt ?? "")).not.toContain("Tóm tắt");
  });
  it("HUB-FR-133 · Q5 · A92 · project chỉ đọc ⇒ summary false, không thêm mục; tenant không hiệu lực lúc start ⇒ snapshot như cũ", async () => {
    need();
    const sh = await runRow(c.sql, await startRun(c, "k1-shared"));
    expect(sh?.snapshot?.kh).toEqual({
      stages: [{ project: PROJ.shared, read_only: true, summary: false }],
    });
    expect(sections(sh?.snapshot?.stages?.[0])).toEqual(["Bảng ý", "Tổng tiền"]);
    await settle(c.sql);
    await c.sql`update hub.kh_tenants set enabled = false where tenant_id = ${T.acme}`;
    try {
      const off = await runRow(c.sql, await startRun(c, "k1-auto"));
      expect(off?.snapshot?.kh).toBeUndefined();
      expect(off?.snapshot?.stages).toEqual(await defStages("k1-auto"));
    } finally {
      await c.sql`update hub.kh_tenants set enabled = true where tenant_id = ${T.acme}`;
    }
  });
});

describe("A93–A97 · ghi worklog khi stage xong [K1-AC05 · D6 · D7]", () => {
  it("HUB-FR-133 · K1-AC05 · A93 · auto chốt output ⇒ kh_writes pending (subject, body, idem kw-…-v1); khWriteOnce ⇒ POST worklog đúng ns/project/subject/khoá ⇒ done; view summary pending→written", async () => {
    need();
    const runId = await startRun(c, "k1-auto");
    await finish(c, runId, 0, mdSum());
    const sr = await waitStage(c.sql, runId, 0, "done");
    const [w] = await writesOf(c.sql, runId);
    expect(w).toMatchObject({
      status: "pending",
      project_id: PROJ.a,
      subject: "k1-auto/a0",
      body: SUM_TEXT,
      idem_key: `kw-${runId}-${sr?.id}-v1`,
      output_id: sr?.current_output_id,
      attempts: 0,
    });
    expect((await viewOf(c, "A", runId)).json?.stages?.[0]?.knowledge?.summary).toBe("pending");
    await khWriteOnce(c);
    expect(c.kh.worklog).toEqual([
      {
        ns: NS.acme,
        project: PROJ.a,
        subject: "k1-auto/a0",
        text: SUM_TEXT,
        idem: `kw-${runId}-${sr?.id}-v1`,
        id: "wl_1",
      },
    ]);
    expect((await writesOf(c.sql, runId))[0]).toMatchObject({ status: "done", kh_id: "wl_1" });
    expect((await viewOf(c, "A", runId)).json?.stages?.[0]?.knowledge?.summary).toBe("written");
  });
  it("HUB-FR-133 · K1-AC05 · A94 · gate: chờ duyệt ⇒ chưa ghi; Chưa đạt ⇒ không ghi; chạy lại + Đạt ⇒ đúng 1 hàng, khoá theo version output hiện tại", async () => {
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
    const [o] =
      await c.sql`select version from hub.process_outputs where id = ${sr?.current_output_id}`;
    const ws = await writesOf(c.sql, runId);
    expect(ws.map((w) => [w.subject, w.body, w.idem_key])).toEqual([
      ["k1-gate/g0", "TOM-TAT-V2", `kw-${runId}-${sr?.id}-v${o?.version}`],
    ]);
    await khWriteOnce(c);
    expect(c.kh.worklog.map((x) => x.text)).toEqual(["TOM-TAT-V2"]);
  });
  it("HUB-FR-133 · HUB-FR-132 · K1-AC05 · A95 · project chỉ đọc ⇒ không ghi (không hàng, KH không nhận worklog); output không có Tóm tắt ⇒ không hàng", async () => {
    need();
    const runId = await startRun(c, "k1-shared");
    await finish(c, runId, 0, mdSum());
    await waitStage(c.sql, runId, 0, "done");
    expect(await writesOf(c.sql, runId)).toEqual([]);
    await khWriteOnce(c);
    expect(c.kh.worklog).toEqual([]);
    expect((await viewOf(c, "A", runId)).json?.stages?.[0]?.knowledge).toMatchObject({
      read_only: true,
      summary: "none",
    });
    await settle(c.sql);
    const none = await startRun(c, "k1-none");
    await finish(c, none, 0, mdSum());
    await waitStage(c.sql, none, 0, "done");
    expect(await writesOf(c.sql, none)).toEqual([]);
  });
  it("HUB-FR-133 · A96 · Tóm tắt > 200 từ ⇒ body 200 từ + '…', ≤ 4000 ký tự", async () => {
    need();
    const runId = await startRun(c, "k1-auto");
    const words = Array.from({ length: 260 }, (_, i) => `t${i}`);
    await finish(c, runId, 0, mdSum(words.join(" ")));
    await waitStage(c.sql, runId, 0, "done");
    const [w] = await writesOf(c.sql, runId);
    expect(String(w?.body).startsWith(words.slice(0, 200).join(" "))).toBe(true);
    expect(String(w?.body).includes("t200")).toBe(false);
    expect(String(w?.body).length).toBeLessThanOrEqual(4000);
  });
  it("HUB-FR-133 · A97 · gửi lại cùng hàng (mất thuê) ⇒ cùng Idempotency-Key, KH chỉ có 1 dòng worklog, hàng done", async () => {
    need();
    const runId = await startRun(c, "k1-auto");
    await finish(c, runId, 0, mdSum());
    await waitStage(c.sql, runId, 0, "done");
    await khWriteOnce(c);
    await c.sql`update hub.kh_writes set status = 'pending', next_at = now() - interval '1 second' where process_run_id = ${runId}`;
    await khWriteOnce(c);
    const posts = c.kh.calls.filter((x) => x.path === `/v1/${NS.acme}/worklog`);
    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((p) => p.idem)).size).toBe(1);
    expect(c.kh.worklog).toHaveLength(1);
    expect((await writesOf(c.sql, runId)).map((w) => w.status)).toEqual(["done"]);
  });
});

describe("A98–A101 · KH lỗi khi ghi [HUB-FR-134 · K1-AC06]", () => {
  async function pending(): Promise<string> {
    const runId = await startRun(c, "k1-auto");
    await finish(c, runId, 0, mdSum());
    await waitStage(c.sql, runId, 0, "done");
    return runId;
  }
  it("HUB-FR-134 · K1-AC06 · A98 · 503 embedder ⇒ pending attempts 1, next_at ≥ ~30 s, last_code; run vẫn chạy (stage 1 có job)", async () => {
    need();
    const runId = await pending();
    c.kh.set(NS.acme, { scenario: "embedder_unavailable" });
    await khWriteOnce(c);
    const [w] =
      await c.sql`select status, attempts, last_code, extract(epoch from (next_at - now()))::int as wait
      from hub.kh_writes where process_run_id = ${runId}`;
    expect([w?.status, w?.attempts, w?.last_code]).toEqual(["pending", 1, "embedder_unavailable"]);
    expect(Number(w?.wait)).toBeGreaterThanOrEqual(25);
    expect((await stageJob(c, runId, 1)).id).toBeTruthy();
    expect((await runRow(c.sql, runId))?.status).not.toBe("failed");
  });
  it("HUB-FR-134 · K1-AC06 · A99 · hết 5 lần ⇒ failed + audit write_fail kh_worklog {code, attempts 5}", async () => {
    need();
    const runId = await pending();
    c.kh.set(NS.acme, { scenario: "server_error" });
    const a0 = await auditMaxK1(c.sql);
    for (let i = 0; i < 6; i++) {
      await dueNow(c.sql);
      await khWriteOnce(c);
    }
    const [w] = await writesOf(c.sql, runId);
    expect([w?.status, w?.attempts]).toEqual(["failed", 5]);
    expect(c.kh.calls.filter((x) => x.path.endsWith("/worklog"))).toHaveLength(5);
    const au = await auditSinceK1(c.sql, a0, "kh_worklog");
    expect(au.map((x) => [x.action, x.entity_name, x.tenant_id])).toEqual([
      ["write_fail", "k1-auto/a0", T.acme],
    ]);
    expect(au[0]?.summary).toMatchObject({ code: "server_error", attempts: 5 });
  });
  it("HUB-FR-134 · A100 · 403 ⇒ failed ngay (không thử lại) + audit write_fail", async () => {
    need();
    const runId = await pending();
    c.kh.set(NS.acme, { scenario: "forbidden" });
    await khWriteOnce(c);
    await dueNow(c.sql);
    await khWriteOnce(c);
    expect((await writesOf(c.sql, runId)).map((w) => [w.status, w.attempts])).toEqual([
      ["failed", 1],
    ]);
    expect(c.kh.calls.filter((x) => x.path.endsWith("/worklog"))).toHaveLength(1);
  });
  it("HUB-FR-134 · Q5 · A101 · tenant tắt trước khi gửi ⇒ skipped + audit write_fail, KH không nhận worklog", async () => {
    need();
    const runId = await pending();
    await c.sql`update hub.kh_tenants set enabled = false where tenant_id = ${T.acme}`;
    try {
      const a0 = await auditMaxK1(c.sql);
      await khWriteOnce(c);
      expect((await writesOf(c.sql, runId)).map((w) => w.status)).toEqual(["skipped"]);
      expect(c.kh.calls.filter((x) => x.path.endsWith("/worklog"))).toEqual([]);
      expect((await auditSinceK1(c.sql, a0, "kh_worklog")).map((x) => x.action)).toEqual([
        "write_fail",
      ]);
    } finally {
      await c.sql`update hub.kh_tenants set enabled = true where tenant_id = ${T.acme}`;
    }
  });
});
