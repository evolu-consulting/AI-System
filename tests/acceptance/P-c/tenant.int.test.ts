// HUB-BR-14 · HUB-BR-32 · PC-R14 · P-c1 · plan §6.6 · test-plan §3 T01–T04: chỉ tenant sở hữu (và người xem được run) thấy kết quả
// tự-sửa — tenant khác 404 ở view run + nội dung diff/log; job của run khác không tải được diff (PB-R18); token job beta không báo
// được cho job acme. Đỏ trước code: `needPc` (0031 vắng).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  afRows,
  type CtxPc,
  content,
  internalGet,
  mkAf,
  needPc,
  postReport,
  reportAndDone,
  reportFor,
  settlePc,
  startAf,
  startPc,
  viewOf,
  waitStatus,
} from "./_support/pc";

let c: CtxPc;
beforeAll(async () => {
  c = await startPc();
  if (c.pc) await mkAf(c, "pc-t");
}, 60_000);
afterEach(async () => {
  await settlePc(c);
});
afterAll(async () => {
  await c?.stop();
});

async function okRun() {
  const a = await startAf(c, "pc-t");
  await reportAndDone(c, a.job, a.token, reportFor(a.job));
  await waitStatus(c.sql, a.runId, "waiting_review");
  const [row] = await afRows(c.sql, a.runId);
  return {
    ...a,
    diffId: row?.diff_attachment_id as string,
    logId: row?.test_log_attachment_id as string,
  };
}

describe("T01–T04 · cách ly tenant [PC-R14, HUB-BR-14]", () => {
  it("HUB-BR-14 · PC-R14 · T01 · tenant_admin beta: view run acme 404; nội dung diff + log acme 404 (thân như id không tồn tại)", async () => {
    needPc(c);
    const a = await okRun();
    expect((await viewOf(c, "Db", a.runId)).status).toBe(404);
    const d = await content(c, "Db", a.diffId);
    const l = await content(c, "Db", a.logId);
    const ghost = await content(c, "Db", "c0c20000-0000-4000-8000-000000000999");
    expect([d.status, l.status]).toEqual([404, 404]);
    expect(JSON.stringify(d.json)).toBe(JSON.stringify(ghost.json));
  }, 30_000);
  it("HUB-BR-14 · T02 · đối chứng: A (người bắt đầu) + B (người duyệt Kế toán) tải được diff 200", async () => {
    needPc(c);
    const a = await okRun();
    expect([
      (await content(c, "A", a.diffId)).status,
      (await content(c, "B", a.diffId)).status,
    ]).toEqual([200, 200]);
  }, 30_000);
  it("HUB-BR-14 · PB-R18 · T03 · job của run KHÁC (cùng tenant) tải diff run này qua /internal ⇒ 404", async () => {
    needPc(c);
    const a = await okRun();
    const b = await startAf(c, "pc-t");
    expect((await internalGet(c, b.job.id, b.token, a.diffId)).status).toBe(404);
  }, 45_000);
  it("HUB-BR-14 · PC-R14 · T04 · token job đúng nhưng job_id của run khác ⇒ 401; không ghi hàng vào run kia", async () => {
    needPc(c);
    const a = await startAf(c, "pc-t");
    const b = await startAf(c, "pc-t");
    const r = await postReport(c, b.job.id, a.token, reportFor(b.job));
    expect(r.status).toBe(401);
    expect((await afRows(c.sql, b.runId)).length).toBe(0);
  }, 30_000);
});
