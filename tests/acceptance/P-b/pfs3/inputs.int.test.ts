// P-b · PF-S3 · HUB-FR-124/125 · PB-R13/R14 · AC-H37 · C19/C20/C23 · IN-01…IN-07, MK-01…MK-04 (test-plan §4.3).
// Đầu vào quy trình `inputs[]` qua `POST /process-runs` (chat `CreateProcessRunRequest`, đường `!key` P-b1): lưu `process_runs.inputs`,
// ghi đè branch của nguồn, đưa text vào prompt; validate C19 (key∈def, type khớp, select∈options, source_ref git_remote cùng tenant ⇒ 422
// VALIDATION_ERROR); thiếu required vẫn bắt đầu (agent hỏi, chip lấy từ `GET /process-runs/sources`, KHÔNG từ ask.choices — C20);
// `must_know` vào prompt, tổng hỏi ≤ 3 lần/stage (HUB-FR-110).
// Đỏ trước code S3: `inputs` bị contract strict từ chối (400) / không lưu; item resolve không đổi branch; must_know không vào prompt.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { insertSource } from "../pfs1/_local";
import {
  C2,
  type Ctx3,
  type Job,
  type Json,
  jobAsk,
  mkDef,
  nextStageJob,
  openTask,
  PA,
  runRow,
  SRC,
  seedSources,
  settle,
  stageRow,
  start3,
  startPinned,
  startRun,
  T,
  vcode,
  waitResolveJobs,
  waitStatus,
} from "./_local";

const INPUT_DEFS: Json[] = [
  { key: "repo", label: "Repo + branch", type: "source_ref", required: true },
  { key: "goal", label: "Mục tiêu", type: "text", required: true },
  { key: "env", label: "Môi trường", type: "select", required: false, options: ["dev", "stg"] },
  { key: "doc", label: "Tài liệu đính kèm", type: "file", required: false },
];
const srcRef = (source_key = "app-repo", branch = "dev", key = "repo"): Json => ({
  type: "source_ref",
  key,
  source_key,
  branch,
});
const text = (value: string, key = "goal"): Json => ({ type: "text", key, text: value });

let c: Ctx3;
beforeAll(async () => {
  c = await start3();
  await seedSources(c);
  await insertSource(c.sql, {
    tenant: T.acme,
    key: "pb-docs",
    kind: "local_path",
    config: { kind: "local_path", path: "/qc-roots/pb-docs" },
  });
  await mkDef(c, "pbx-none", { stages: [{ key: "n1", after: "review" }] });
  await mkDef(c, "pbx-in", {
    sources: ["app-repo", "other-repo"],
    inputs: INPUT_DEFS,
    stages: [{ key: "i0", sources: [SRC("app-repo", "src/**")], after: "auto" }],
  });
  await mkDef(c, "pbx-mk", {
    sources: ["app-repo"],
    stages: [
      {
        key: "k0",
        sources: [SRC("app-repo", "src/**")],
        must_know: ["Phiên bản cần sửa?", "Môi trường test?"],
        after: "review",
      },
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
/** Đối chứng: inputs hợp lệ được nhận (201) — chặn xanh giả khi contract hiện từ chối MỌI `inputs` bằng 400. */
async function validControl(): Promise<void> {
  const ok = await startRun(c, "pbx-in", {
    inputs: [srcRef("app-repo", "main"), text("đối chứng")],
  });
  expect(ok.res.status).toBe(201);
  await settle(c);
}
const nRuns = async (): Promise<number> =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs`)[0]?.n ?? -1;

describe("IN-01…02 · source_ref + text [PB-R13, AC-H37, C19]", () => {
  it("AC-H37 · IN-01 · inputs [source_ref app-repo@dev, text] ⇒ 201, process_runs.inputs lưu, item resolve branch 'dev', prompt chứa text", async () => {
    const inputs = [srcRef("app-repo", "dev"), text("Thêm nút xuất")];
    const s = await startPinned(c, "pbx-in", { inputs });
    expect(s.res.status).toBe(201);
    expect((await runRow(c.sql, s.runId)).inputs).toEqual(inputs);
    const jobs = await waitResolveJobs(c.sql, s.runId);
    expect(jobs).toHaveLength(1);
    expect(((jobs[0] as { payload: unknown }).payload as Json).items[0].config).toMatchObject({
      kind: "git_remote",
      branch: "dev",
    });
    expect((await runRow(c.sql, s.runId)).pinned_sources[0].sha).toBe(C2); // resolver giả: dev ⇒ C2
    expect(prompt(s.job)).toContain("Thêm nút xuất");
  }, 45_000);

  it.each([
    ["nguồn của tenant beta", "beta-repo"],
    ["nguồn kind library", "docs-lib"],
    ["nguồn kind local_path", "pb-docs"],
    ["key không tồn tại", "khong-co"],
  ])(
    "AC-H37 · C19 · IN-02 · source_ref trỏ %s ⇒ 422 VALIDATION_ERROR (không 404/500), không tạo run",
    async (_n, key) => {
      await validControl();
      const before = await nRuns();
      const r = await startRun(c, "pbx-in", { inputs: [srcRef(key, "main"), text("x")] });
      expect(vcode(r.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
      expect(await nRuns()).toBe(before);
    },
    30_000,
  );
});

describe("IN-03 · thiếu required ⇒ vẫn bắt đầu, AskCard chip [PB-R13, C20]", () => {
  it("AC-H37 · IN-03 · thiếu `goal` (required) ⇒ vẫn 201; agent hỏi ⇒ ask không điền choices bằng key nguồn; chip lấy từ GET /process-runs/sources (git_remote acme)", async () => {
    const none = await startRun(c, "pbx-in"); // không có inputs hoàn toàn
    expect(none.res.status).toBe(201);
    await settle(c);
    const s = await startPinned(c, "pbx-in", { inputs: [srcRef("app-repo", "main")] });
    expect(s.res.status).toBe(201);
    await jobAsk(c, s.job, "Mục tiêu là gì?", []);
    await waitStatus(c.sql, s.runId, "waiting_answer");
    const t = await openTask(c.sql, s.runId, "ask");
    expect(t?.question).toBe("Mục tiêu là gì?");
    expect(t?.choices).toEqual([]); // Hub KHÔNG nhét key nguồn vào choices (C20)
    const chips = await c.call("A", "GET", "/process-runs/sources");
    expect(chips.status).toBe(200);
    const git = (chips.json as Json[])
      .filter((x) => x.kind === "git_remote")
      .map((x) => x.key)
      .sort();
    expect(git).toEqual(["app-repo", "other-repo"]); // không nguồn beta
    expect((chips.json as Json[]).find((x) => x.key === "app-repo")).toMatchObject({
      description: "Mã nguồn ứng dụng kế toán",
      default_branch: "main",
    });
  }, 45_000);
});

describe("IN-04…07 · validate inputs [C19]", () => {
  async function seedAtt(userId: string, tenant: string): Promise<string | null> {
    const id = crypto.randomUUID();
    try {
      await c.sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename, safe_name, mime, size,
        sha256, storage_key) values (${id}, ${tenant}, ${userId}, 'upload', null, 'tai-lieu.md', 'tai-lieu.md',
        'text/markdown', 10, ${"b".repeat(64)}, ${`${tenant}/${id}`})`;
      return id;
    } catch {
      return null;
    }
  }

  it.each([
    ["người khác cùng tenant (hoa)", PA.B.id, T.acme],
    ["tenant khác (beta)", PA.D.id, T.beta],
  ])(
    "PB-R18 · IN-04 · file attachment_id của %s ⇒ 4xx, id không vào payload.attachments của job nào",
    async (_n, userId, tenant) => {
      const att = await seedAtt(userId, tenant);
      expect(att).not.toBeNull(); // fixture: hub.attachments nhận origin 'upload'
      await validControl();
      const before = await nRuns();
      const r = await startRun(c, "pbx-in", {
        inputs: [
          srcRef("app-repo", "main"),
          text("x"),
          { type: "file", key: "doc", attachment_id: att },
        ],
      });
      expect(r.res.status).toBeGreaterThanOrEqual(400);
      expect(r.res.status).toBeLessThan(500);
      expect(await nRuns()).toBe(before);
      const [leak] = await c.sql<
        { n: number }[]
      >`select count(*)::int as n from hub.jobs where payload::text like ${`%${att}%`}`;
      expect(leak?.n).toBe(0);
    },
    30_000,
  );

  it("AC-H37 · IN-05 · select value ngoài options ⇒ 422 VALIDATION_ERROR", async () => {
    const before = await nRuns();
    const r = await startRun(c, "pbx-in", {
      inputs: [
        srcRef("app-repo", "main"),
        text("x"),
        { type: "select", key: "env", value: "prod" },
      ],
    });
    expect(vcode(r.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(await nRuns()).toBe(before);
    const okSel = await startRun(c, "pbx-in", {
      inputs: [srcRef("app-repo", "main"), text("x"), { type: "select", key: "env", value: "stg" }],
    });
    expect(okSel.res.status).toBe(201); // đối chứng: giá trị trong options hợp lệ
  }, 30_000);

  it("AC-H37 · IN-06 · input key không khai trong def / type lệch def ⇒ 422 VALIDATION_ERROR", async () => {
    await validControl();
    const before = await nRuns();
    const lạ = await startRun(c, "pbx-in", { inputs: [text("x", "khong-khai")] });
    expect(vcode(lạ.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    const lech = await startRun(c, "pbx-in", {
      inputs: [{ type: "select", key: "goal", value: "dev" }], // goal khai là text
    });
    expect(vcode(lech.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(await nRuns()).toBe(before);
  }, 30_000);

  it("AC-H37 · IN-07 · 11 inputs ⇒ 422 (tối đa 10)", async () => {
    const before = await nRuns();
    const r = await startRun(c, "pbx-in", {
      inputs: Array.from({ length: 11 }, () => text("x")),
    });
    expect(vcode(r.res)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    expect(await nRuns()).toBe(before);
    const ten = await startRun(c, "pbx-in", {
      inputs: Array.from({ length: 10 }, () => text("x")),
    });
    expect(ten.res.status).toBe(201); // đối chứng: đúng 10 vẫn qua
  }, 30_000);
});

describe("MK-01…04 · must_know [PB-R14, HUB-FR-125, HUB-FR-110]", () => {
  const MK = ["Phiên bản cần sửa?", "Môi trường test?"];

  it("HUB-FR-125 · MK-01 · must_know 2 mục ⇒ prompt chứa cả hai", async () => {
    const s = await startPinned(c, "pbx-mk");
    for (const m of MK) expect(prompt(s.job)).toContain(m);
  }, 30_000);

  it.each([
    ["MK-02", ["Cần thêm thông tin gì?", MK[0], MK[1]]],
    ["MK-03", [MK[0], "Hạn chót bao giờ?", MK[1]]],
  ] as [string, string[]][])(
    "HUB-FR-110 · %s · 3 lần hỏi đã trả lời (tính chung must_know + hỏi thường) ⇒ lần 4 KHÔNG mở ask, needs_decision ask_limit",
    async (_id, questions) => {
      const s = await startPinned(c, "pbx-mk");
      for (const m of MK) expect(prompt(s.job)).toContain(m); // checklist must_know đã vào prompt
      let job = s.job;
      for (const q of questions) {
        await jobAsk(c, job, q as string, []);
        await waitStatus(c.sql, s.runId, "waiting_answer");
        const t = await openTask(c.sql, s.runId, "ask");
        expect(t?.question).toBe(q);
        const r = await c.call("A", "POST", `/review-tasks/${t?.id}/answer`, { answer: "Đã rõ" });
        expect(r.status).toBe(200);
        job = await nextStageJob(c, s.runId);
      }
      expect((await stageRow(c.sql, s.runId, 0)).asks_count).toBe(3);
      await jobAsk(c, job, "Còn gì cần biết nữa?", []);
      await waitStatus(c.sql, s.runId, "needs_decision");
      expect((await runRow(c.sql, s.runId)).decision?.reason).toBe("ask_limit");
      expect(await openTask(c.sql, s.runId, "ask")).toBeUndefined();
    },
    60_000,
  );

  it("HUB-FR-125 · MK-04 · stage không must_know không đổi (hồi quy P-a): prompt không có mục checklist, không payload.sources", async () => {
    const s = await startRun(c, "pbx-none");
    const j = await nextStageJob(c, s.runId);
    for (const m of MK) expect(prompt(j)).not.toContain(m);
    expect((j.payload as unknown as Json).sources).toBeUndefined();
  }, 30_000);
});
