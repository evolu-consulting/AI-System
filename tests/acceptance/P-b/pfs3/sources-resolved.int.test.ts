// P-b · PF-S3 · PB-R18 · HUB-BR-29 · AC-PB-04 · C12 · RS-01…RS-13 (test-plan §4.3).
// `POST /internal/jobs/:job_id/sources-resolved` (Bearer job-token của CHÍNH job `source.resolve`): sai token/run/tenant/loại/đã kết thúc
// ⇒ 401 cùng một thân (không phân biệt nguyên nhân); `source_id ∉ items` ⇒ 422 VALIDATION_ERROR (C12); body sai ⇒ 4xx; không ghim.
// Đỏ trước code S3: run chưa phát job `source.resolve` (claimResolve ném `ĐỎ-DO-CHƯA-CODE-S3`), pinned_sources vẫn NULL.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  agentRunCount,
  C1,
  type Ctx3,
  claimResolve,
  type Json,
  mkDef,
  newJobToken,
  nextStageJob,
  noStageJob,
  okBody,
  postResolved,
  type ResolveJob,
  runRow,
  SRC,
  seedSources,
  settle,
  start3,
  startRun,
  tokenHash,
  URL_APP,
  vcode,
  waitFor,
  X,
} from "./_local";

let c: Ctx3;
beforeAll(async () => {
  c = await start3();
  await seedSources(c);
  await mkDef(c, "pbx-none", { stages: [{ key: "n1", after: "review" }] });
  await mkDef(c, "pbx-src", {
    sources: ["app-repo"],
    stages: [{ key: "s0", sources: [SRC("app-repo", "src/**")], after: "auto" }],
  });
}, 90_000);
afterEach(async () => {
  if (c) await settle(c);
});
afterAll(async () => {
  await c?.stop();
});

/** Run + job resolve đã claim (token biết). */
async function armed(role: "A" | "B" = "A"): Promise<{ runId: string; job: ResolveJob }> {
  const s = await startRun(c, "pbx-src", { role });
  expect(s.res.status).toBe(201);
  return { runId: s.runId, job: await claimResolve(c, s.runId) };
}
const pinned = async (runId: string) => (await runRow(c.sql, runId)).pinned_sources;
const is4xx = (n: number) => n >= 400 && n < 500;

describe("RS-01…06 · xác thực job-token [PB-R18, AC-PB-04]", () => {
  it("PB-R18 · RS-01 · token đúng + body ok ⇒ 2xx, ghim, launch stage 0", async () => {
    const { runId, job } = await armed();
    const r = await postResolved(c, job.id, job.token, okBody(job.payload));
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(300);
    await nextStageJob(c, runId);
    expect(await pinned(runId)).toEqual([{ kind: "git_remote", url: URL_APP, sha: C1 }]);
  }, 30_000);

  it("PB-R18 · RS-02 · không Authorization ⇒ 401, không ghim", async () => {
    const { runId, job } = await armed();
    const r = await postResolved(c, job.id, null, okBody(job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("PB-R18 · RS-03 · token rác ⇒ 401, không ghim", async () => {
    const { runId, job } = await armed();
    const r = await postResolved(c, job.id, "pbtok-rac", okBody(job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("PB-R18 · RS-04 · job-token của job agent.cli (sai loại) dùng cho job resolve ⇒ 401", async () => {
    const { runId, job } = await armed();
    const other = await startRun(c, "pbx-none");
    const agentJob = await nextStageJob(c, other.runId);
    const tok = newJobToken();
    await c.sql`update hub.jobs set token_hash = ${tokenHash(tok)} where id = ${agentJob.id}`;
    const r = await postResolved(c, job.id, tok, okBody(job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("AC-PB-04 · RS-05 · token job resolve của run A gọi :job_id của run B ⇒ 401, không ghim B", async () => {
    const a = await armed("A");
    const b = await armed("B");
    const r = await postResolved(c, b.job.id, a.job.token, okBody(b.job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(b.runId)).toBeNull();
    expect(await pinned(a.runId)).toBeNull();
  }, 30_000);

  it("PB-R18 · RS-06 · job đã kết thúc (replay) ⇒ 401, không ghim", async () => {
    const { runId, job } = await armed();
    await c.sql`update hub.jobs set status = 'succeeded', finished_at = now() where id = ${job.id}`;
    const r = await postResolved(c, job.id, job.token, okBody(job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(runId)).toBeNull();
  }, 30_000);
});

describe("RS-07…11 · nội dung báo cáo [C12, PB-R05]", () => {
  it("C12 · RS-07 · results có source_id ngoài items (token hợp lệ) ⇒ 422 VALIDATION_ERROR (khác 401), không ghim", async () => {
    const { runId, job } = await armed();
    const body = okBody(job.payload);
    const foreign = { ...body.results[0], source_id: X(999) };
    const r1 = await postResolved(c, job.id, job.token, { results: [foreign] });
    expect(vcode(r1)).toEqual({ status: 422, code: "VALIDATION_ERROR" });
    const r2 = await postResolved(c, job.id, job.token, { results: [body.results[0], foreign] });
    expect(vcode(r2)).toEqual({ status: 422, code: "VALIDATION_ERROR" }); // từ chối CẢ báo cáo
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("PB-R05 · RS-08 · body sai strict (trường thừa / results rỗng / thiếu pin) ⇒ 4xx ≠ 401, không ghim", async () => {
    const { runId, job } = await armed();
    const ok = okBody(job.payload);
    const noPin = { results: [{ ...ok.results[0], pin: undefined }] };
    for (const body of [{ ...ok, extra: 1 }, { results: [] }, noPin]) {
      const r = await postResolved(c, job.id, job.token, body);
      expect(is4xx(r.status)).toBe(true);
      expect(r.status).not.toBe(401);
    }
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("PB-R18 · RS-09 · token hết hạn (lease quá hạn, seam now) ⇒ 401, không ghim", async () => {
    const { runId, job } = await armed();
    await c.sql`update hub.jobs set started_at = now() - interval '1 hour', heartbeat_at = now() - interval '1 hour'
      where id = ${job.id}`;
    c.clock.off = 3_600_000;
    const r = await postResolved(c, job.id, job.token, okBody(job.payload));
    expect(r.status).toBe(401);
    expect(await pinned(runId)).toBeNull();
  }, 30_000);

  it("PB-R05 · RS-10 · gửi trùng đồng thời ⇒ ghim 1 lần, đúng 1 job stage 0", async () => {
    const { runId, job } = await armed();
    const body = okBody(job.payload);
    const rs = await Promise.all([1, 2, 3].map(() => postResolved(c, job.id, job.token, body)));
    expect(rs.some((r) => r.status >= 200 && r.status < 300)).toBe(true);
    await nextStageJob(c, runId);
    await waitFor(
      () => agentRunCount(c.sql, runId),
      (n) => n >= 2,
      1_500,
    );
    expect(await agentRunCount(c.sql, runId)).toBe(1);
    expect(await pinned(runId)).toHaveLength(1);
  }, 30_000);

  it("PB-R05 · RS-11 · pin.kind ≠ item.kind (git_remote ↔ library) ⇒ từ chối, không ghim", async () => {
    const { runId, job } = await armed();
    const wrong = okBody(job.payload, {
      status: "ok",
      pin: { kind: "library", document_id: X(701), version: X(801) },
    });
    const r = await postResolved(c, job.id, job.token, wrong);
    expect(is4xx(r.status)).toBe(true);
    expect(await pinned(runId)).toBeNull();
    expect(await noStageJob(c, runId, 500)).toBe(true);
  }, 30_000);
});

describe("RS-12…13 · 401 một thân; token resolve không dùng cho API khác [AC-PB-04]", () => {
  it("PB-R18 · RS-12 · mọi nguyên nhân 401 trả CÙNG một thân (không phân biệt)", async () => {
    const a = await armed("A");
    const b = await armed("B");
    const other = await startRun(c, "pbx-none");
    const agentJob = await nextStageJob(c, other.runId);
    const agTok = newJobToken();
    await c.sql`update hub.jobs set token_hash = ${tokenHash(agTok)} where id = ${agentJob.id}`;
    const body = okBody(b.job.payload);
    const rs = [
      await postResolved(c, b.job.id, null, body), // thiếu
      await postResolved(c, b.job.id, "pbtok-rac", body), // rác
      await postResolved(c, b.job.id, a.job.token, body), // token job khác
      await postResolved(c, b.job.id, agTok, body), // sai loại
    ];
    expect(rs.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    for (const r of rs) expect(r.text).toBe((rs[0] as { text: string }).text);
    expect((rs[0] as { json: Json }).json?.error?.code).toBeTruthy();
  }, 30_000);

  it("AC-PB-04 · RS-13 · job-token resolve dùng cho /internal/jobs/:id/outputs và attachments ⇒ 401", async () => {
    const { job } = await armed();
    const up = await fetch(`${c.base}/internal/jobs/${job.id}/outputs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${job.token}`,
        "x-filename": "x.md",
        "content-type": "text/markdown",
      },
      body: "# x",
    });
    expect(up.status).toBe(401);
    const dl = await fetch(`${c.base}/internal/jobs/${job.id}/attachments/${X(998)}`, {
      headers: { authorization: `Bearer ${job.token}` },
    });
    expect(dl.status).toBe(401);
  }, 30_000);
});
