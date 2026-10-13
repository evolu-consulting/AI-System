// HUB-FR-128 · HUB-FR-130 · WRK-FR-29 · HUB-BR-14 · PC-R12 · PC-R14 · P-c1 · plan §3.3, §6.2 · test-plan §3 E01–E09: kênh báo
// `POST /internal/jobs/:job_id/autofix-result` (token job) — 201 + lưu blob diff/log (attachments output) + `autofix_results`;
// 401 một thân; 409 AUTOFIX_NOT_EXPECTED / AUTOFIX_RESULT_EXISTS; 400 VALIDATION_ERROR; 413 PAYLOAD_TOO_LARGE; `no-store`.
// Đỏ trước code: `needPc` (0031 vắng) + def `autofix` 400 + route 404.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  afRows,
  attRow,
  type CtxPc,
  DIFF,
  failedReport,
  jobDone,
  MD_AUTO,
  mkAf,
  mkPlain,
  needPc,
  PA,
  postReport,
  reportFor,
  settlePc,
  startAf,
  startPc,
  startPlain,
  T,
} from "./_support/pc";

let c: CtxPc;
beforeAll(async () => {
  c = await startPc();
  if (c.pc) {
    await mkAf(c, "pc-rep");
    await mkAf(c, "pc-rep2");
    await mkPlain(c, "pc-plain");
  }
}, 60_000);
afterEach(async () => {
  await settlePc(c);
});
afterAll(async () => {
  await c?.stop();
});

describe("E01–E04 · xác thực + trạng thái job", () => {
  it("HUB-BR-14 · PC-R14 · E01 · không token / token job khác / token sai ⇒ 401 UNAUTHORIZED, cùng một thân; không ghi hàng", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const b = await startAf(c, "pc-rep2");
    const none = await postReport(c, a.job.id, null, reportFor(a.job));
    const other = await postReport(c, a.job.id, b.token, reportFor(a.job));
    const wrong = await postReport(c, a.job.id, "qc-not-a-token", reportFor(a.job));
    expect([none.status, other.status, wrong.status]).toEqual([401, 401, 401]);
    expect(none.json?.error?.code).toBe("UNAUTHORIZED");
    expect(new Set([none.text, other.text, wrong.text]).size).toBe(1);
    expect((await afRows(c.sql, a.runId)).length).toBe(0);
  }, 30_000);
  it("HUB-FR-130 · E02 · job không có `autofix` (stage thường) ⇒ 409 AUTOFIX_NOT_EXPECTED", async () => {
    needPc(c);
    const s = await startPlain(c, "pc-plain");
    const r = await postReport(
      c,
      s.job.id,
      s.token,
      reportFor(s.job, { branch: `ai/${s.runId}/fix` }),
    );
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 409,
      code: "AUTOFIX_NOT_EXPECTED",
    });
  }, 30_000);
  it("HUB-FR-130 · E03 · job đã kết thúc (không `running`) ⇒ 409 AUTOFIX_NOT_EXPECTED", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    await jobDone(c, a.job, MD_AUTO);
    const r = await postReport(c, a.job.id, a.token, reportFor(a.job));
    expect({ status: r.status, code: r.json?.error?.code }).toEqual({
      status: 409,
      code: "AUTOFIX_NOT_EXPECTED",
    });
  }, 30_000);
  it("HUB-FR-130 · plan §1 bước 7 · E04 · báo lần 2 (retry mạng) ⇒ 409 AUTOFIX_RESULT_EXISTS; vẫn đúng 1 hàng", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const one = await postReport(c, a.job.id, a.token, reportFor(a.job));
    const two = await postReport(c, a.job.id, a.token, reportFor(a.job));
    expect({ one: one.status, two: two.status, code: two.json?.error?.code }).toEqual({
      one: 201,
      two: 409,
      code: "AUTOFIX_RESULT_EXISTS",
    });
    expect((await afRows(c.sql, a.runId)).length).toBe(1);
  }, 30_000);
});

describe("E05–E07 · validate + trần + header", () => {
  it("HUB-FR-128 · E05 · nhánh ≠ payload.autofix.branch ⇒ 400; check_failed kèm diff ⇒ 400; thân không phải JSON ⇒ 400", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const wrongBranch = await postReport(
      c,
      a.job.id,
      a.token,
      reportFor(a.job, { branch: `ai/${a.runId}/khac` }),
    );
    const diffOnFail = await postReport(c, a.job.id, a.token, {
      ...failedReport(a.job, []),
      diff: DIFF,
    });
    const notJson = await postReport(c, a.job.id, a.token, null, "{not json");
    expect([wrongBranch, diffOnFail, notJson].map((r) => [r.status, r.json?.error?.code])).toEqual([
      [400, "VALIDATION_ERROR"],
      [400, "VALIDATION_ERROR"],
      [400, "VALIDATION_ERROR"],
    ]);
    expect((await afRows(c.sql, a.runId)).length).toBe(0);
  }, 30_000);
  it("WRK-FR-29 · PC-R08 · E06 · diff > 2 MiB ⇒ 413 PAYLOAD_TOO_LARGE; thân > 3 MiB ⇒ 413; không ghi hàng", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const big = "+".repeat(2_097_153);
    const r1 = await postReport(c, a.job.id, a.token, reportFor(a.job, { diff: big }));
    const r2 = await postReport(
      c,
      a.job.id,
      a.token,
      null,
      JSON.stringify(reportFor(a.job, { pad: "x".repeat(3_200_000) })),
    );
    expect([r1.status, r1.json?.error?.code, r2.status]).toEqual([413, "PAYLOAD_TOO_LARGE", 413]);
    expect((await afRows(c.sql, a.runId)).length).toBe(0);
  }, 30_000);
  it("HUB-FR-130 · E07 · mọi phản hồi `Cache-Control: no-store` (201 và lỗi)", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const bad = await postReport(c, a.job.id, null, reportFor(a.job));
    const ok = await postReport(c, a.job.id, a.token, reportFor(a.job));
    expect([ok.status, ok.headers.get("cache-control"), bad.headers.get("cache-control")]).toEqual([
      201,
      "no-store",
      "no-store",
    ]);
  }, 30_000);
});

describe("E08–E09 · lưu trữ + audit [PC-R12]", () => {
  it("HUB-FR-130 · PC-R12 · B4 · E08 · ok ⇒ 201 {id}; hàng đủ trường audit; diff + log = attachments output text/plain `<stage>-r1.diff.txt`/`-test.log.txt` của job", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const r = await postReport(c, a.job.id, a.token, reportFor(a.job));
    expect(r.status).toBe(201);
    const [row] = await afRows(c.sql, a.runId);
    expect(row?.id).toBe(r.json?.id);
    expect({
      job: row?.job_id,
      round: row?.round,
      src: row?.source_key,
      branch: row?.branch,
      status: row?.status,
      exit: row?.test_exit_code,
      ms: row?.test_duration_ms,
      cmds: (row?.commands ?? []).length,
      pinSha: row?.pin?.sha,
    }).toEqual({
      job: a.job.id,
      round: 1,
      src: "app-repo",
      branch: `ai/${a.runId}/fix`,
      status: "ok",
      exit: 0,
      ms: 12_400,
      cmds: 1,
      pinSha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    });
    const diff = await attRow(c.sql, row?.diff_attachment_id);
    const log = await attRow(c.sql, row?.test_log_attachment_id);
    expect([diff?.origin, diff?.job_id, diff?.mime, diff?.filename]).toEqual([
      "output",
      a.job.id,
      "text/plain",
      "fix-r1.diff.txt",
    ]);
    expect([log?.origin, log?.mime, log?.filename]).toEqual([
      "output",
      "text/plain",
      "fix-r1-test.log.txt",
    ]);
  }, 30_000);
  it("HUB-FR-130 · PC-R08 · PC-R12 · E09 · check_failed có test ⇒ không diff, CÓ log; failures lưu đúng; no_changes ⇒ không diff, test null ⇒ không log", async () => {
    needPc(c);
    const a = await startAf(c, "pc-rep");
    const fails = [{ check: "tests", detail: "exit 1: 2 failed" }];
    const t = { exit_code: 1, duration_ms: 3_000, log_tail: "2 fail" };
    expect((await postReport(c, a.job.id, a.token, failedReport(a.job, fails, t))).status).toBe(
      201,
    );
    const [row] = await afRows(c.sql, a.runId);
    expect([
      row?.status,
      row?.diff_attachment_id,
      row?.test_log_attachment_id !== null,
      row?.failures,
    ]).toEqual(["check_failed", null, true, fails]);
    const b = await startAf(c, "pc-rep2");
    const nc = reportFor(b.job, { status: "no_changes", diff: null, diff_stats: null, test: null });
    expect((await postReport(c, b.job.id, b.token, nc)).status).toBe(201);
    const [r2] = await afRows(c.sql, b.runId);
    expect([r2?.status, r2?.diff_attachment_id, r2?.test_log_attachment_id]).toEqual([
      "no_changes",
      null,
      null,
    ]);
  }, 30_000);
  it("HUB-FR-130 · PC-R16 · E10 · tenant đã vượt hạn mức file (1 GiB) vẫn ghi được diff/log tự-sửa (201); file vẫn cộng vào dung lượng đã dùng", async () => {
    needPc(c);
    const used = async (): Promise<number> =>
      Number(
        (
          await c.sql<
            { u: string }[]
          >`select coalesce(sum(size),0)::bigint as u from hub.attachments
            where tenant_id = ${T.acme} and purged_at is null`
        )[0]?.u,
      );
    // 52 × 20 MiB = 1,040 MiB > hạn mức 1 GiB của fixture (start3: tenantMaxBytes 1_073_741_824).
    await c.sql`insert into hub.attachments (id, tenant_id, user_id, origin, job_id, filename, safe_name, mime, size,
      sha256, storage_key)
      select g.id, ${T.acme}, ${PA.A.id}, 'upload', null, 'qc-filler.txt', 'qc-filler.txt', 'text/plain',
        20971520, ${"c".repeat(64)}, ${T.acme} || '/' || g.id
      from (select gen_random_uuid() as id from generate_series(1, 52)) g`;
    try {
      const before = await used();
      expect(before).toBeGreaterThan(1_073_741_824);
      const a = await startAf(c, "pc-rep");
      const r = await postReport(c, a.job.id, a.token, reportFor(a.job));
      expect(r.status).toBe(201);
      const [row] = await afRows(c.sql, a.runId);
      const diff = await attRow(c.sql, row?.diff_attachment_id);
      const log = await attRow(c.sql, row?.test_log_attachment_id);
      expect(diff?.origin).toBe("output");
      expect(log?.origin).toBe("output");
      expect(await used()).toBe(before + Number(diff?.size) + Number(log?.size));
    } finally {
      await c.sql`delete from hub.attachments where tenant_id = ${T.acme} and filename = 'qc-filler.txt'`;
    }
  }, 30_000);
});
