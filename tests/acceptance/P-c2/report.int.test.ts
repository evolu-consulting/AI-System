// HUB-FR-129 · HUB-FR-130 · HUB-BR-14 · PC2-R13 · P-c2 · plan §3.5, §6.3, C8, C10, C11 · test-plan P-c2 §4 E01–E08:
// `POST /internal/jobs/:id/apply-result` — 401 một thân (trước 413), 400 thân sai, 413 > 256 KiB, 409 APPLY_NOT_EXPECTED (job không
// `source.apply`/không running), 201 lưu hàng `autofix_applies` (mode = payload.apply_mode — C8; log test ⇒ attachment), 409
// APPLY_RESULT_EXISTS. E01–E04 job dựng SQL; E05–E08 job do Hub tạo sau gate Đạt (launcher B7).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  applyBody,
  attRow,
  C1,
  type CtxPc2,
  claimApply,
  HEAD,
  type Json,
  mkApply,
  needPc2,
  newJobToken,
  oneApply,
  PA,
  passGate,
  postApply,
  settlePc2,
  startPc2,
  T,
  TARGET2,
  toApply,
  toGate,
  tokenHash,
  Y,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
  if (!c.pc2) return;
  await mkApply(c, "pc2-e", "gh-priv");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

let seq = 0;
async function sqlJob(type: string, status = "running") {
  const id = Y(6000 + ++seq);
  const token = newJobToken();
  await c.sql`insert into hub.jobs (id, tenant_id, user_id, type, payload, status, token_hash, worker_id, started_at)
    values (${id}, ${T.acme}, ${PA.A.id}, ${type}, ${c.sql.json({ v: 1, type, job_id: id, tenant_id: T.acme })},
      ${status}, ${tokenHash(token)}, 'qc-rt-e', now())`;
  return { id, token };
}
const rowsOf = async (jobId: string) =>
  (
    await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.autofix_applies where job_id = ${jobId}`
  )[0]?.n;

describe("E01–E04 · xác thực + validate [plan §3.5]", () => {
  it("HUB-BR-14 · E01 · không token / token rác / token job khác ⇒ 401 cùng thân; thân > 256 KiB không token ⇒ vẫn 401", async () => {
    needPc2(c);
    const j = await sqlJob("source.apply");
    const other = await sqlJob("source.apply");
    const big = JSON.stringify({ ...applyBody(), detail: "x".repeat(300_000) });
    const rs = [
      await postApply(c, j.id, null, applyBody()),
      await postApply(c, j.id, "rac", applyBody()),
      await postApply(c, j.id, other.token, applyBody()),
      await postApply(c, j.id, null, null, big),
    ];
    expect(rs.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(new Set(rs.map((r) => r.text)).size).toBe(1);
    expect(await rowsOf(j.id)).toBe(0);
  });
  it("HUB-FR-129 · E02 · thân sai hợp đồng (head khi conflict, code ngoài 4 mã, thiếu target khi pushed, khoá lạ) ⇒ 400 VALIDATION_ERROR; > 256 KiB ⇒ 413", async () => {
    needPc2(c);
    const j = await sqlJob("source.apply");
    for (const b of [
      applyBody({ status: "conflict" }),
      applyBody({ status: "failed", head_sha: null, code: "rate_limited" }),
      applyBody({ target_sha: null }),
      applyBody({ token: "x" }),
    ]) {
      const r = await postApply(c, j.id, j.token, b);
      expect({ b, status: r.status, code: r.json?.error?.code }).toEqual({
        b,
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }
    const big = await postApply(
      c,
      j.id,
      j.token,
      null,
      JSON.stringify({ ...applyBody(), pad: "x".repeat(300_000) }),
    );
    expect(big.status).toBe(413);
    expect(await rowsOf(j.id)).toBe(0);
  });
  it("HUB-FR-129 · E03 · job loại khác (source.resolve) hoặc job source.apply đã kết thúc ⇒ 409 APPLY_NOT_EXPECTED; no-store", async () => {
    needPc2(c);
    for (const j of [await sqlJob("source.resolve"), await sqlJob("source.apply", "succeeded")]) {
      const r = await postApply(c, j.id, j.token, applyBody());
      expect({ status: r.status, code: r.json?.error?.code }).toEqual({
        status: 409,
        code: "APPLY_NOT_EXPECTED",
      });
      expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    }
  });
  it("HUB-BR-14 · E04 · token đúng của job A gọi URL job B ⇒ 401 (token gắn job)", async () => {
    needPc2(c);
    const a = await sqlJob("source.apply");
    const b = await sqlJob("source.apply");
    expect((await postApply(c, b.id, a.token, applyBody())).status).toBe(401);
  });
});

describe("E05–E08 · lưu hàng autofix_applies [PC2-R13, C8, C10, C11]", () => {
  it("HUB-FR-130 · PC2-R13 · C10 · E05 · pushed + rebased + test ⇒ 201 {id}; hàng đủ (nguồn, mode, nhánh, pin, target, head, rebase, kết quả tự-sửa, test, log attachment <stage>-apply-test.log.txt)", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-e");
    const r = await postApply(
      c,
      a.aj.id,
      a.aj.token,
      applyBody({
        target_sha: TARGET2,
        rebased: true,
        test: { exit_code: 0, duration_ms: 3_400, log_tail: "12 pass\n0 fail" },
      }),
    );
    expect({ status: r.status, id: typeof r.json?.id }).toEqual({ status: 201, id: "string" });
    expect(r.headers.get("cache-control") ?? "").toContain("no-store");
    const row = await oneApply(c.sql, a.runId);
    const [af] = await c.sql<
      Json[]
    >`select id from hub.autofix_results where process_run_id = ${a.runId}`;
    expect({
      id: row.id,
      job: row.job_id,
      key: row.source_key,
      mode: row.mode,
      status: row.status,
      branch: row.branch,
      pin: row.pin_sha,
      target: row.target_sha,
      head: row.head_sha,
      rebased: row.rebased,
      af: row.autofix_result_id,
      exit: row.test_exit_code,
      ms: row.test_duration_ms,
      err: row.error_code,
    }).toEqual({
      id: r.json?.id,
      job: a.aj.id,
      key: "gh-priv",
      mode: "pr",
      status: "pushed",
      branch: `ai/${a.runId}/fix`,
      pin: C1,
      target: TARGET2,
      head: HEAD,
      rebased: true,
      af: af?.id,
      exit: 0,
      ms: 3_400,
      err: null,
    });
    const log = await attRow(c.sql, row.test_log_attachment_id);
    expect(log?.filename).toMatch(/^(apply|fix)-apply-test\.log\.txt$/);
    expect(log?.mime).toBe("text/plain");
  }, 45_000);
  it("HUB-FR-129 · E06 · báo cáo lần 2 cùng job ⇒ 409 APPLY_RESULT_EXISTS, vẫn 1 hàng", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-e");
    expect((await postApply(c, a.aj.id, a.aj.token, applyBody())).status).toBe(201);
    const r2 = await postApply(c, a.aj.id, a.aj.token, applyBody({ head_sha: TARGET2 }));
    expect({ status: r2.status, code: r2.json?.error?.code }).toEqual({
      status: 409,
      code: "APPLY_RESULT_EXISTS",
    });
    expect(await rowsOf(a.aj.id)).toBe(1);
  }, 45_000);
  it("HUB-FR-129 · C11 · E07 · conflict ⇒ conflict_files, error_code null; check_failed ⇒ error_code check_failed + failures; failed{auth} ⇒ error_code auth", async () => {
    needPc2(c);
    const want: [Json, Json][] = [
      [
        { status: "conflict", head_sha: null, rebased: true, conflict_files: ["src/tong.ts"] },
        { status: "conflict", err: null, files: ["src/tong.ts"], fails: 0 },
      ],
      [
        {
          status: "check_failed",
          head_sha: null,
          rebased: true,
          failures: [{ check: "tests", detail: "exit 1" }],
          test: { exit_code: 1, duration_ms: 900, log_tail: "1 fail" },
        },
        { status: "check_failed", err: "check_failed", files: [], fails: 1 },
      ],
      [
        { status: "failed", head_sha: null, code: "auth" },
        { status: "failed", err: "auth", files: [], fails: 0 },
      ],
    ];
    for (const [body, exp] of want) {
      const a = await toApply(c, "pc2-e");
      expect((await postApply(c, a.aj.id, a.aj.token, applyBody(body))).status).toBe(201);
      const row = await oneApply(c.sql, a.runId);
      expect({
        status: row.status,
        err: row.error_code,
        files: row.conflict_files,
        fails: (row.failures as Json[]).length,
      }).toEqual(exp);
      await settlePc2(c);
    }
  }, 90_000);
  it("HUB-FR-129 · C8 · E08 · mode hàng = payload.apply_mode lúc launch (đổi nguồn sau khi job tạo không ảnh hưởng)", async () => {
    needPc2(c);
    const g = await toGate(c, "pc2-e");
    await passGate(c, g);
    const aj = await claimApply(c, g.runId);
    expect(aj.payload?.apply_mode).toBe("pr");
    await c.sql`update hub.sources set config = config || ${c.sql.json({ apply_mode: "branch_only" })}
      where id = ${c.src.priv}`;
    try {
      expect((await postApply(c, aj.id, aj.token, applyBody())).status).toBe(201);
      expect((await oneApply(c.sql, g.runId)).mode).toBe("pr");
    } finally {
      await c.sql`update hub.sources set config = config - 'apply_mode' where id = ${c.src.priv}`;
    }
  }, 45_000);
});
