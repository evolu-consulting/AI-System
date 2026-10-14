// P-b · PF-S3 · HUB-FR-122 · PB-R05 · PB-R10 · HUB-BR-27 · AC-H36(a)(c) · ST-01…ST-14 (test-plan §4.3).
// Start run có nguồn ⇒ cổng launcher: `pinned_sources IS NULL` ⇒ enqueue `source.resolve` (KHÔNG launch stage 0) ⇒ Runtime giả báo
// `/sources-resolved` ⇒ ghim + launch. Lỗi/quá hạn ⇒ `needs_decision source_unresolvable`. "Làm lại" dùng pin cũ (không resolve lại).
// Đỏ trước code S3: launcher chưa enqueue resolve cho run (0 job `source.resolve`), `pinned_sources` chưa được set, payload.sources vắng.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  AG_TOOLS,
  agentRunCount,
  C1,
  type Ctx3,
  doneWithRefs,
  type Json,
  jobDone,
  MD_AUTO,
  mkDef,
  nextStageJob,
  noStageJob,
  openTask,
  refLine,
  resolveJobs,
  resolver,
  review,
  runRow,
  SRC,
  seedSources,
  settle,
  start3,
  startPinned,
  startRun,
  sweep,
  URL_APP,
  waitFor,
  waitResolveJobs,
  waitStatus,
} from "./_local";

let c: Ctx3;
beforeAll(async () => {
  c = await start3();
  await seedSources(c);
  await mkDef(c, "pbx-none", { stages: [{ key: "n1", after: "review" }] });
  await mkDef(c, "pbx-src", {
    sources: ["app-repo"],
    stages: [
      { key: "s0", sources: [SRC("app-repo", "src/**")], after: "review" },
      { key: "s1", sources: [SRC("app-repo", "docs/**")], after: "auto" },
    ],
  });
  await mkDef(c, "pbx-all", {
    sources: ["app-repo"],
    stages: [
      { key: "a0", sources: [SRC("app-repo")], after: "auto" },
      { key: "a1", sources: [SRC("app-repo", "docs/**")], after: "auto" },
    ],
  });
  await mkDef(c, "pbx-tools", {
    sources: ["app-repo"],
    stages: [{ key: "t0", agent: AG_TOOLS, sources: [SRC("app-repo", "src/**")], after: "auto" }],
  });
  await mkDef(c, "pbx-tools-none", { stages: [{ key: "t0", agent: AG_TOOLS, after: "auto" }] });
  await mkDef(c, "pbx-multi", {
    sources: ["app-repo", "other-repo"],
    stages: [{ key: "m0", sources: [SRC("app-repo", "src/**"), SRC("other-repo")], after: "auto" }],
  });
  await mkDef(c, "pbx-mixed", {
    sources: ["app-repo"],
    stages: [
      { key: "x0", after: "auto" },
      { key: "x1", sources: [SRC("app-repo", "src/**")], after: "auto" },
    ],
  });
}, 90_000);
afterEach(async () => {
  if (c) await settle(c);
});
afterAll(async () => {
  await c?.stop();
});

const payloadOf = (j: { payload: unknown }) => j.payload as Json;
const RGG = ["Read", "Grep", "Glob"];

async function expectUnresolvable(runId: string): Promise<Json> {
  await waitStatus(c.sql, runId, "needs_decision");
  const run = await runRow(c.sql, runId);
  expect(run.decision?.reason).toBe("source_unresolvable");
  expect(run.pinned_sources).toBeNull(); // không ghim từng phần
  expect(await agentRunCount(c.sql, runId)).toBe(0); // chưa launch stage 0
  return run;
}

describe("ST-01 · def không nguồn [HUB-FR-122, hồi quy P-a]", () => {
  it("HUB-FR-122 · ST-01 · def không nguồn ⇒ pinned_sources=[], KHÔNG job source.resolve, stage 0 launch như P-a", async () => {
    const s = await startRun(c, "pbx-none");
    expect(s.res.status).toBe(201);
    await nextStageJob(c, s.runId);
    expect((await runRow(c.sql, s.runId)).pinned_sources).toEqual([]);
    expect(await resolveJobs(c.sql, s.runId)).toHaveLength(0);
  }, 30_000);
});

describe("ST-02…04 · cổng launcher enqueue source.resolve [PB-R05]", () => {
  it("PB-R05 · ST-02 · def có nguồn ⇒ pinned_sources NULL, đúng 1 job source.resolve queued (items[0] union ['docs/**','src/**']), CHƯA job agent", async () => {
    const s = await startRun(c, "pbx-src");
    expect(s.res.status).toBe(201);
    const jobs = await waitResolveJobs(c.sql, s.runId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe("queued");
    const p = payloadOf(jobs[0] as { payload: unknown });
    expect(p).toMatchObject({ v: 1, type: "source.resolve", process_run_id: s.runId });
    expect(p.items).toHaveLength(1);
    expect(p.items[0]).toEqual({
      source_id: c.ids.app,
      key: "app-repo",
      kind: "git_remote",
      config: { kind: "git_remote", url: URL_APP, branch: "main", credential_secret_id: null },
      allowlist_union: ["docs/**", "src/**"],
    });
    expect(p.timeout_s).toBeGreaterThanOrEqual(10);
    expect(p.timeout_s).toBeLessThanOrEqual(300);
    const run = await runRow(c.sql, s.runId);
    expect(run.pinned_sources).toBeNull();
    expect(await agentRunCount(c.sql, s.runId)).toBe(0);
  }, 30_000);

  it("PB-R06 · ST-03 · một stage dùng [] (cả nguồn) ⇒ allowlist_union == []", async () => {
    const s = await startRun(c, "pbx-all");
    const jobs = await waitResolveJobs(c.sql, s.runId);
    expect(jobs).toHaveLength(1);
    expect(payloadOf(jobs[0] as { payload: unknown }).items[0].allowlist_union).toEqual([]);
  }, 30_000);

  it("PB-R05 · ST-04 · launcher.kick/sweep gọi nhiều lần ⇒ vẫn đúng 1 job resolve (idempotent)", async () => {
    const s = await startRun(c, "pbx-src");
    expect(await waitResolveJobs(c.sql, s.runId)).toHaveLength(1);
    for (let i = 0; i < 3; i++) await sweep(c);
    const h = c.hub.handles() as Json;
    const kick = h?.launcher?.kick ?? h?.kick;
    if (typeof kick === "function") for (let i = 0; i < 3; i++) await kick(s.runId);
    expect(await resolveJobs(c.sql, s.runId)).toHaveLength(1);
  }, 30_000);
});

describe("ST-05…06 · ghim + payload.sources [PB-R05, PB-R10, AC-H36(a)]", () => {
  it("AC-H36 · ST-05 · Runtime báo ok pin(C1) ⇒ pinned_sources + sources_pinned_at; job stage 0 có payload.sources (allowlist CỦA STAGE)", async () => {
    const s = await startPinned(c, "pbx-src");
    const run = await runRow(c.sql, s.runId);
    expect(run.pinned_sources).toEqual([{ kind: "git_remote", url: URL_APP, sha: C1 }]);
    expect(run.sources_pinned_at).not.toBeNull();
    expect(payloadOf(s.job).sources).toEqual([
      {
        key: "app-repo",
        kind: "git_remote",
        pin: { kind: "git_remote", url: URL_APP, sha: C1 },
        allowlist: ["src/**"], // của stage s0, không phải union ['docs/**','src/**']
      },
    ]);
  }, 30_000);

  it("PB-R10 · ST-06 · agent cấu hình allowed_tools=[Read,Write,Bash,WebFetch] + stage có nguồn ⇒ payload.allowed_tools == ['Read','Grep','Glob']", async () => {
    const ctl = await startRun(c, "pbx-tools-none");
    const ctlJob = await nextStageJob(c, ctl.runId);
    expect(payloadOf(ctlJob).allowed_tools).toContain("Write"); // đối chứng: agent thật sự có công cụ rộng
    const s = await startPinned(c, "pbx-tools");
    expect(payloadOf(s.job).allowed_tools).toEqual(RGG);
  }, 30_000);
});

describe("ST-07…10 · lỗi resolve ⇒ needs_decision source_unresolvable [PB-R05, C9, C23]", () => {
  it("PB-R05 · ST-07 · Runtime báo error SOURCE_UNRESOLVABLE ⇒ needs_decision source_unresolvable (options retry+cancel), pinned NULL, không job agent", async () => {
    const rs = resolver(c, () => ({ status: "error", code: "SOURCE_UNRESOLVABLE" }));
    const s = await startRun(c, "pbx-src");
    const run = await expectUnresolvable(s.runId);
    expect(run.decision?.options).toEqual(expect.arrayContaining(["add_attempt", "cancel"]));
    await waitFor(
      async () => rs.posts.length,
      (v) => v >= 1, // posts ghi sau khi POST resolved trả về ⇒ chờ theo điều kiện
      4_000,
    );
    expect(rs.posts.length).toBeGreaterThanOrEqual(1);
    expect(await noStageJob(c, s.runId)).toBe(true);
  }, 30_000);

  it("C9 · ST-07b · Runtime báo error SOURCE_TOO_LARGE ⇒ needs_decision source_unresolvable (không failed/NOT_CONFIGURED)", async () => {
    resolver(c, () => ({
      status: "error",
      code: "SOURCE_TOO_LARGE",
      message: "SOURCE_TOO_LARGE: 2001 file",
    }));
    const s = await startRun(c, "pbx-src");
    await expectUnresolvable(s.runId);
    const bad = await c.sql`select id from hub.runs where process_run_id = ${s.runId}`;
    expect(bad).toHaveLength(0);
  }, 30_000);

  it("PB-R05 · ST-08 · job resolve failed (Runtime chết) ⇒ cùng kết quả ST-07", async () => {
    resolver(c, () => "silent");
    const s = await startRun(c, "pbx-src");
    const jobs = await waitResolveJobs(c.sql, s.runId);
    expect(jobs).toHaveLength(1); // đỏ ở đây khi Hub chưa phát job resolve
    const id = jobs[0]?.id as string;
    await waitFor(
      async () => (await resolveJobs(c.sql, s.runId))[0]?.status,
      (v) => v === "running",
      4_000,
    );
    await c.sql`update hub.jobs set status = 'failed', error_code = 'INTERNAL_ERROR', error_message = 'runtime chết',
      finished_at = now() where id = ${id}`;
    await waitFor(
      async () => {
        await sweep(c);
        return (await runRow(c.sql, s.runId)).status;
      },
      (v) => v === "needs_decision",
      8_000,
    );
    await expectUnresolvable(s.runId);
  }, 30_000);

  it.each([
    ["claim rồi im lặng (quá hạn lease/timeout_s)", true],
    ["không ai claim (Runtime offline, C23)", false],
  ])(
    "PB-R05 · ST-08b · %s ⇒ quá hạn (seam now) ⇒ needs_decision source_unresolvable",
    async (_n, claim) => {
      if (claim) resolver(c, () => "silent");
      const s = await startRun(c, "pbx-src");
      expect(await waitResolveJobs(c.sql, s.runId)).toHaveLength(1);
      c.clock.off = 3_600_000; // +1 giờ ≫ timeout_s ≤ 300
      await waitFor(
        async () => {
          await sweep(c);
          return (await runRow(c.sql, s.runId)).status;
        },
        (v) => v === "needs_decision",
        8_000,
      );
      await expectUnresolvable(s.runId);
    },
    30_000,
  );

  it("PB-R05 · ST-09 · decide add_attempt (retry) ⇒ job resolve mới; ok ⇒ chạy stage 0; decide cancel ⇒ cancelled", async () => {
    const bad = resolver(c, () => ({ status: "error", code: "SOURCE_UNRESOLVABLE" }));
    const s = await startRun(c, "pbx-src");
    await expectUnresolvable(s.runId);
    await bad.stop();
    const good = resolver(c); // Runtime hồi phục
    const d = await c.call("A", "POST", `/process-runs/${s.runId}/decide`, {
      option: "add_attempt",
    });
    expect(d.status).toBe(200);
    await nextStageJob(c, s.runId);
    expect(await resolveJobs(c.sql, s.runId)).toHaveLength(2);
    expect((await runRow(c.sql, s.runId)).pinned_sources).toEqual([
      { kind: "git_remote", url: URL_APP, sha: C1 },
    ]);

    await good.stop(); // hết đua với bad2 cho job resolve của s2
    const bad2 = resolver(c, () => ({ status: "error", code: "SOURCE_UNRESOLVABLE" }));
    const s2 = await startRun(c, "pbx-src");
    await expectUnresolvable(s2.runId);
    await bad2.stop();
    const x = await c.call("A", "POST", `/process-runs/${s2.runId}/decide`, { option: "cancel" });
    expect(x.status).toBe(200);
    expect((await runRow(c.sql, s2.runId)).status).toBe("cancelled");
  }, 45_000);

  it("PB-R05 · ST-10 · 2 nguồn, 1 ok + 1 error ⇒ needs_decision, pinned_sources NULL (không ghim từng phần)", async () => {
    resolver(c, (item) =>
      item.key === "other-repo"
        ? { status: "error", code: "SOURCE_UNRESOLVABLE" }
        : { status: "ok" },
    );
    const s = await startRun(c, "pbx-multi");
    await expectUnresolvable(s.runId);
  }, 30_000);
});

describe("ST-11…14 · làm lại / run mới / dùng chung [HUB-BR-27, AC-H36(c)]", () => {
  const putBranch = async (branch: string) => {
    const g = await c.call("Adm", "GET", "/admin/sources/app-repo");
    expect(g.status).toBe(200);
    const r = await c.call("Adm", "PUT", "/admin/sources/app-repo", {
      config: { kind: "git_remote", url: URL_APP, branch },
      description: g.json.description,
      version: g.json.version,
    });
    expect(r.status).toBe(200);
  };

  it("AC-H36 · ST-11 · ghim C1 rồi PUT nguồn sang branch dev; stage 0 'làm lại' ⇒ job mới pin.sha==C1; tổng job resolve của run vẫn 1", async () => {
    const s = await startPinned(c, "pbx-src");
    await doneWithRefs(c, s.job, [refLine("app-repo", "src/index.ts", C1)]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    await putBranch("dev");
    const t = await openTask(c.sql, s.runId, "review");
    expect(t).toBeDefined();
    const r = await review(c, "B", t?.id, { result: "fail", feedback: "Làm lại cho kỹ" });
    expect(r.status).toBe(200);
    const j2 = await nextStageJob(c, s.runId);
    expect(payloadOf(j2).sources[0].pin).toEqual({ kind: "git_remote", url: URL_APP, sha: C1 });
    expect(await resolveJobs(c.sql, s.runId)).toHaveLength(1);
    expect(s.rs.seen).toHaveLength(1);
  }, 45_000);

  it("PB-R05 · ST-12 · run mới sau PUT dev ⇒ items[0].config.branch=='dev'; run cũ không đổi", async () => {
    const r1 = await startPinned(c, "pbx-src");
    await putBranch("dev");
    const r2 = await startRun(c, "pbx-src");
    expect(r2.res.status).toBe(201);
    const jobs = await waitResolveJobs(c.sql, r2.runId);
    expect(jobs).toHaveLength(1);
    expect(payloadOf(jobs[0] as { payload: unknown }).items[0].config.branch).toBe("dev");
    expect((await runRow(c.sql, r1.runId)).pinned_sources).toEqual([
      { kind: "git_remote", url: URL_APP, sha: C1 },
    ]);
  }, 45_000);

  it("HUB-BR-27 · ST-13 · 2 stage cùng app-repo ⇒ pinned_sources 1 phần tử; cả hai job cùng sha; 1 job resolve", async () => {
    const s = await startPinned(c, "pbx-src");
    await doneWithRefs(c, s.job, [refLine("app-repo", "src/index.ts", C1)]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const t = await openTask(c.sql, s.runId, "review");
    expect((await review(c, "B", t?.id, { result: "pass" })).status).toBe(200);
    const j2 = await nextStageJob(c, s.runId);
    expect(payloadOf(j2).sources).toEqual([
      {
        key: "app-repo",
        kind: "git_remote",
        pin: { kind: "git_remote", url: URL_APP, sha: C1 },
        allowlist: ["docs/**"],
      },
    ]);
    expect((await runRow(c.sql, s.runId)).pinned_sources).toHaveLength(1);
    expect(await resolveJobs(c.sql, s.runId)).toHaveLength(1);
  }, 45_000);

  it("PB-R10 · ST-14 · stage không nguồn trong def có nguồn ⇒ payload.sources vắng/[], allowed_tools mặc định P-a; stage kế có nguồn ⇒ R/G/G", async () => {
    const ctl = await startRun(c, "pbx-none");
    const ctlJob = await nextStageJob(c, ctl.runId);
    const s = await startPinned(c, "pbx-mixed");
    const sources = payloadOf(s.job).sources;
    expect(sources === undefined || (Array.isArray(sources) && sources.length === 0)).toBe(true);
    expect(payloadOf(s.job).allowed_tools).toEqual(payloadOf(ctlJob).allowed_tools);
    await jobDone(c, s.job, MD_AUTO);
    const j1 = await nextStageJob(c, s.runId);
    expect(payloadOf(j1).sources).toHaveLength(1);
    expect(payloadOf(j1).allowed_tools).toEqual(RGG);
  }, 45_000);
});
