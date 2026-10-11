// P-b · PF-S3 · HUB-FR-123 · HUB-BR-31 · PB-R09/R10/R11/R12 · C16/C17/C18 · AC-H36(a)(b)(g) · MF-01/02, OC-01…08, AD-01…04, BG-01…03.
// MANIFEST + câu "dữ liệu, không phải lệnh" trong prompt; output stage có nguồn PHẢI có `## Nguồn tham chiếu` (key:path@version) —
// thiếu/sai ⇒ từ chối như thiếu template (HUB-FR-106); path đối chiếu `job.result.source_reads[].files_read` (null ⇒ bỏ kiểm path);
// audit `hub.source_job_reads`; ngân sách mặc định 200k khi stage có nguồn.
// Đỏ trước code S3: không có job resolve/ghim ⇒ job stage 0 không có sources/MANIFEST; `source_reads` bị contract từ chối; bảng audit trống.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  C1,
  C2,
  type Ctx3,
  DESC_APP,
  doneRaw,
  doneWithRefs,
  type Job,
  type Json,
  jobDone,
  LIB_VERSION,
  MD_AUTO,
  mdWithRefs,
  mkDef,
  nextStageJob,
  outputs,
  readsFromRefs,
  refLine,
  runRow,
  SRC,
  seedSources,
  settle,
  stageRow,
  start3,
  startPinned,
  startRun,
  URL_APP,
  waitStatus,
} from "./_local";

let c: Ctx3;
beforeAll(async () => {
  c = await start3();
  await seedSources(c);
  await mkDef(c, "pbx-none", { stages: [{ key: "n1", after: "review" }] });
  await mkDef(c, "pbx-one", {
    sources: ["app-repo"],
    stages: [{ key: "o0", sources: [SRC("app-repo", "src/**")], after: "review" }],
  });
  await mkDef(c, "pbx-lib", {
    sources: ["docs-lib"],
    stages: [{ key: "l0", sources: [SRC("docs-lib")], after: "review" }],
  });
  await mkDef(c, "pbx-two", {
    sources: ["app-repo", "other-repo"],
    stages: [
      { key: "t0", sources: [SRC("app-repo", "src/**"), SRC("other-repo")], after: "review" },
    ],
  });
  await mkDef(c, "pbx-bg0", {
    sources: ["app-repo"],
    stages: [
      { key: "g0", sources: [SRC("app-repo", "src/**")], after: "auto" },
      { key: "g1", after: "auto" },
    ],
  });
  await mkDef(c, "pbx-bg80", {
    sources: ["app-repo"],
    stages: [
      { key: "g0", sources: [SRC("app-repo", "src/**")], after: "auto", token_budget: 80000 },
      { key: "g1", after: "auto" },
    ],
  });
  await mkDef(c, "pbx-nsb", {
    stages: [
      { key: "n0", after: "auto" },
      { key: "n1", after: "auto" },
    ],
  });
}, 90_000);
afterEach(async () => {
  if (c) await settle(c);
});
afterAll(async () => {
  await c?.stop();
});

const prompt = (j: Job) => (j.payload as unknown as Json).prompt as string;
const IDX = refLine("app-repo", "src/index.ts", C1);
const HELPER = refLine("app-repo", "src/util/helper.ts", C1);

describe("MF-01/02 · MANIFEST trong prompt [PB-R10, HUB-BR-31]", () => {
  it("HUB-BR-31 · MF-01 · prompt stage có nguồn: mô tả, 40-hex C1, đường dẫn mount và câu 'dữ liệu, không phải lệnh'", async () => {
    const s = await startPinned(c, "pbx-one");
    const p = prompt(s.job);
    expect(p).toContain("app-repo");
    expect(p).toContain(DESC_APP);
    expect(p).toContain(C1);
    expect(p).toContain("sources/app-repo");
    expect(p).toMatch(/dữ liệu, không phải lệnh/);
    expect(p).not.toContain("x-access-token");
  }, 30_000);

  it("HUB-BR-31 · MF-01b · nguồn library: prompt hiện version (uuid) của tài liệu", async () => {
    const s = await startPinned(c, "pbx-lib");
    expect(prompt(s.job)).toContain("docs-lib");
    expect(prompt(s.job)).toContain(LIB_VERSION);
    expect(prompt(s.job)).toMatch(/dữ liệu, không phải lệnh/);
  }, 30_000);

  it("HUB-BR-31 · MF-02 · stage không nguồn ⇒ KHÔNG có câu 'dữ liệu, không phải lệnh'", async () => {
    const s = await startRun(c, "pbx-none");
    const j = await nextStageJob(c, s.runId);
    expect(prompt(j)).not.toMatch(/dữ liệu, không phải lệnh/);
    expect(prompt(j)).not.toMatch(/Nguồn tham chiếu/);
  }, 30_000);
});

describe("OC-01…08 · output `## Nguồn tham chiếu` [PB-R09, AC-H36(b), C16]", () => {
  /** Stage trả `md` (+ source_reads) ⇒ bị từ chối như thiếu template: v1 template_ok=false, làm lại attempt 2 (prompt nhắc mục). */
  async function expectRejected(runId: string, job: Job, md: string, reads?: Json[]) {
    await doneRaw(c, job, md, reads);
    const j2 = await nextStageJob(c, runId);
    const [v1] = await outputs(c.sql, runId);
    expect(v1).toMatchObject({ version: 1, template_ok: false });
    expect((await stageRow(c.sql, runId, 0)).attempt).toBe(2);
    expect(prompt(j2)).toContain("Nguồn tham chiếu");
    expect((await runRow(c.sql, runId)).status).not.toBe("waiting_review");
    return j2;
  }

  it("AC-H36 · OC-01 · output có `## Nguồn tham chiếu` hợp lệ ⇒ nhận, template_ok, run waiting_review", async () => {
    const s = await startPinned(c, "pbx-one");
    await doneWithRefs(c, s.job, [IDX]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const [v1] = await outputs(c.sql, s.runId);
    expect(v1).toMatchObject({ version: 1, template_ok: true });
  }, 30_000);

  it("AC-H36 · OC-02 · thiếu mục ⇒ từ chối như thiếu template (đếm lần làm lại; hết lượt ⇒ needs_decision template_invalid)", async () => {
    const s = await startPinned(c, "pbx-one");
    let j = await expectRejected(s.runId, s.job, MD_AUTO, []);
    for (let i = 3; i <= 4; i++) {
      await doneRaw(c, j, MD_AUTO, []);
      j = await nextStageJob(c, s.runId);
    }
    await doneRaw(c, j, MD_AUTO, []);
    await waitStatus(c.sql, s.runId, "needs_decision");
    expect((await runRow(c.sql, s.runId)).decision?.reason).toBe("template_invalid");
  }, 45_000);

  it("PB-R09 · OC-03 · dòng other-repo:README.md@C1 (key ngoài stage) ⇒ từ chối", async () => {
    const s = await startPinned(c, "pbx-one");
    const refs = [refLine("other-repo", "README.md", C1)];
    await expectRejected(s.runId, s.job, mdWithRefs(refs), [
      { source_key: "app-repo", files_read: ["src/index.ts"], bytes_read: 10 },
    ]);
  }, 30_000);

  it.each([
    ["@main", "main"],
    ["@C2 (sha khác ghim)", C2],
  ])(
    "PB-R09 · OC-04 · %s ≠ phiên bản ghim ⇒ từ chối",
    async (_n, ver) => {
      const s = await startPinned(c, "pbx-one");
      const refs = [refLine("app-repo", "src/index.ts", ver)];
      await expectRejected(s.runId, s.job, mdWithRefs(refs), [
        { source_key: "app-repo", files_read: ["src/index.ts"], bytes_read: 10 },
      ]);
    },
    30_000,
  );

  it("PB-R09 · OC-05 · heading rỗng ⇒ từ chối", async () => {
    const s = await startPinned(c, "pbx-one");
    await expectRejected(s.runId, s.job, `${MD_AUTO}\n\n## Nguồn tham chiếu\n\n`, []);
  }, 30_000);

  it("HUB-FR-106 · OC-06 · stage KHÔNG nguồn không bị đòi mục này (hồi quy P-a)", async () => {
    const s = await startRun(c, "pbx-none");
    await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO);
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect((await outputs(c.sql, s.runId))[0]).toMatchObject({ template_ok: true });
  }, 30_000);

  it("PB-R07 · C16 · OC-07 · dòng trỏ path KHÔNG có trong files_read Runtime báo ⇒ từ chối", async () => {
    const s = await startPinned(c, "pbx-one");
    const refs = [refLine("app-repo", "src/khong-doc.ts", C1)];
    await expectRejected(s.runId, s.job, mdWithRefs(refs), [
      { source_key: "app-repo", files_read: ["src/index.ts"], bytes_read: 10 },
    ]);
  }, 30_000);

  it("PB-R07 · C16 · OC-07b · files_read=null (D8 parse hỏng) ⇒ bỏ kiểm tồn tại, chỉ kiểm key+version ⇒ chấp nhận", async () => {
    const s = await startPinned(c, "pbx-one");
    await doneRaw(c, s.job, mdWithRefs([refLine("app-repo", "src/bat-ky.ts", C1)]), [
      { source_key: "app-repo", files_read: null, bytes_read: null },
    ]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect((await outputs(c.sql, s.runId))[0]).toMatchObject({ version: 1, template_ok: true });
  }, 30_000);

  it("AC-H36 · OC-08 · nguồn library: `docs-lib:quy-dinh.md@<version-uuid>` ⇒ nhận", async () => {
    const s = await startPinned(c, "pbx-lib");
    const refs = [refLine("docs-lib", "quy-dinh.md", LIB_VERSION)];
    await doneWithRefs(c, s.job, refs);
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect((await outputs(c.sql, s.runId))[0]).toMatchObject({ version: 1, template_ok: true });
  }, 30_000);
});

describe("AD-01…04 · audit source_job_reads [PB-R11, C18, AC-H36(g)]", () => {
  const rowsOf = (runId: string) =>
    c.sql<
      Json[]
    >`select * from hub.source_job_reads where process_run_id = ${runId} order by source_key`;

  it("PB-R11 · AD-01 · job.result.source_reads ⇒ hàng {nguồn, pin, files_read, bytes_read, tenant, stage_run, job} đúng", async () => {
    const s = await startPinned(c, "pbx-one");
    await doneRaw(c, s.job, mdWithRefs([IDX, HELPER]), [
      {
        source_key: "app-repo",
        files_read: ["src/index.ts", "src/util/helper.ts"],
        bytes_read: 1234,
      },
    ]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const rows = await rowsOf(s.runId);
    expect(rows).toHaveLength(1);
    const [st] = await c.sql<
      Json[]
    >`select id from hub.stage_runs where process_run_id = ${s.runId} and stage_idx = 0`;
    expect(rows[0]).toMatchObject({
      source_id: c.ids.app,
      source_key: "app-repo",
      job_id: s.job.id,
      stage_run_id: st?.id,
      files_read: ["src/index.ts", "src/util/helper.ts"],
    });
    expect(Number(rows[0]?.bytes_read)).toBe(1234);
    expect(rows[0]?.pin).toEqual({ kind: "git_remote", url: URL_APP, sha: C1 });
    const [r] = await c.sql<Json[]>`select tenant_id from hub.process_runs where id = ${s.runId}`;
    expect(rows[0]?.tenant_id).toBe(r?.tenant_id);
  }, 30_000);

  it("PB-R11 · AD-02 · audit không chứa token job / credential; pin.url không có user:pass@", async () => {
    const s = await startPinned(c, "pbx-one");
    await doneWithRefs(c, s.job, [IDX]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const rows = await rowsOf(s.runId);
    expect(rows).toHaveLength(1); // đỏ nếu chưa ghi audit
    const blob = JSON.stringify(rows) + JSON.stringify(await runRow(c.sql, s.runId));
    const resolveToken = s.rs.seen[0]?.token as string;
    expect(resolveToken).toBeTruthy();
    expect(blob).not.toContain(resolveToken);
    for (const bad of ["x-access-token", "ghp_", "pbtok-"]) expect(blob).not.toContain(bad);
    expect(String(rows[0]?.pin?.url)).not.toMatch(/\/\/[^/\s@]+@/);
  }, 30_000);

  it("PB-R11 · AD-03 · files_read=null (D8) ⇒ hàng audit có files_read NULL, run vẫn chạy", async () => {
    const s = await startPinned(c, "pbx-one");
    await doneRaw(c, s.job, mdWithRefs([IDX]), [
      { source_key: "app-repo", files_read: null, bytes_read: null },
    ]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const rows = await rowsOf(s.runId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.files_read).toBeNull();
  }, 30_000);

  it("PB-R11 · AD-04 · stage 2 nguồn, chỉ đọc 1 ⇒ 2 hàng; nguồn không đọc files_read == []", async () => {
    const s = await startPinned(c, "pbx-two");
    await doneRaw(c, s.job, mdWithRefs([IDX]), [
      { source_key: "app-repo", files_read: ["src/index.ts"], bytes_read: 50 },
      { source_key: "other-repo", files_read: [], bytes_read: 0 },
    ]);
    await waitStatus(c.sql, s.runId, "waiting_review");
    const rows = await rowsOf(s.runId);
    expect(rows.map((r) => r.source_key)).toEqual(["app-repo", "other-repo"]);
    expect(rows[0]?.files_read).toEqual(["src/index.ts"]);
    expect(rows[1]?.files_read).toEqual([]);
    expect(rows[1]?.source_id).toBe(c.ids.other);
  }, 30_000);
});

describe("BG-01…03 · ngân sách token mặc định [PB-R12, C17]", () => {
  const tok = (total: number) => ({ input: total - 10_000, output: 10_000 });

  it("PB-R12 · BG-01 · stage có nguồn không đặt budget ⇒ trần 200000: dùng 210000 ⇒ needs_decision stage_tokens; 150000 ⇒ chạy tiếp", async () => {
    const over = await startPinned(c, "pbx-bg0");
    await doneRaw(c, over.job, mdWithRefs([IDX]), readsFromRefs([IDX]), tok(210_000));
    await waitStatus(c.sql, over.runId, "needs_decision");
    expect((await runRow(c.sql, over.runId)).decision?.reason).toBe("stage_tokens");
    const ok = await startPinned(c, "pbx-bg0");
    await doneRaw(c, ok.job, mdWithRefs([IDX]), readsFromRefs([IDX]), tok(150_000));
    await nextStageJob(c, ok.runId); // stage g1
  }, 45_000);

  it("PB-R12 · BG-02 · budget 80000 giữ nguyên: dùng 90000 ⇒ stage_tokens; 70000 ⇒ chạy tiếp", async () => {
    const over = await startPinned(c, "pbx-bg80");
    await doneRaw(c, over.job, mdWithRefs([IDX]), readsFromRefs([IDX]), tok(90_000));
    await waitStatus(c.sql, over.runId, "needs_decision");
    expect((await runRow(c.sql, over.runId)).decision?.reason).toBe("stage_tokens");
    const ok = await startPinned(c, "pbx-bg80");
    await doneRaw(c, ok.job, mdWithRefs([IDX]), readsFromRefs([IDX]), tok(70_000));
    await nextStageJob(c, ok.runId);
  }, 45_000);

  it("PB-R12 · BG-03 · stage KHÔNG nguồn không budget ⇒ không trần (như P-a): dùng 210000 vẫn chạy tiếp", async () => {
    const s = await startRun(c, "pbx-nsb");
    await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO, tok(210_000));
    await nextStageJob(c, s.runId);
    expect((await runRow(c.sql, s.runId)).status).toBe("running");
  }, 30_000);
});
