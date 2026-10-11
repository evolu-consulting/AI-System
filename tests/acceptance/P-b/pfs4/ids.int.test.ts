// AC-PB-04 · PB-R18 · TECH-DEBT #133 · ID-01…ID-06 (test-plan P-b §4.4): id file/nguồn phải thuộc CHÍNH run + tenant của job.
// Job thành viên (token job) tải attachment của run khác / tenant khác / id lạ ⇒ cùng một thân 401. Guard khi ráp `files`
// (ID-05): id ngoài run/tenant bị loại khỏi `payload.attachments`, job vẫn tạo.
// ID-07 (nguồn library acme trỏ document_id beta) cần bảng `hub.sources` (migration 0021) ⇒ thuộc PF-S1 (`pfs1`), KHÔNG ở đây.
// ID-04 phiên bản resolve (RS-05) cũng ở pfs1; ở đây ID-04 = tải output thật của process run khác.
// Trước code: ID-01…04, ID-06 xanh (hồi quy khoá hành vi 401 đã có); ID-05 đỏ ở expect (id lạ lọt vào payload.attachments).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { insertAttachmentRow } from "../../H2c/_h2c";
import { needSchema } from "../../P-a/_support/schema";
import {
  type Ctx4,
  D4,
  getAtt,
  IDS_DEF,
  type Job,
  type Json,
  jobDone,
  MD_AUTO,
  memberKey,
  nextStageJob,
  openTask,
  outputs,
  ownMd,
  review,
  SINGLE_DEF,
  serveAll,
  settleAll,
  startInRoom,
  startPfs4,
  tokenFor,
  waitStatus,
} from "./_local";

let c: Ctx4;
beforeAll(async () => {
  c = await startPfs4();
}, 60_000);
afterEach(async () => {
  if (c?.ready) await settleAll(c.sql);
});
afterAll(async () => {
  await c?.stop();
});

const UNAUTHORIZED = { error: { code: "UNAUTHORIZED", message: "Unauthorized" } };
const MD = new TextEncoder().encode("# tệp ngoài run\nnội dung bí mật");

/** Tạo hàng attachment (kèm blob) cho `who`: upload hoặc output. */
const foreign = (who: "lan" | "an", origin: "upload" | "output" = "upload") =>
  insertAttachmentRow(c.sql, {
    who,
    origin,
    filename: "ngoai-run.md",
    mime: "text/markdown",
    content: MD,
    dir: c.dir,
  });

/** Chạy run nhóm `seq`; ở job thành viên đầu (m1) gọi `probe(job, token)` rồi trả kết quả bình thường. */
async function withM1<T>(probe: (j: Job, token: string) => Promise<T>): Promise<T> {
  const s = await startInRoom(c, { key: D4.seq.key });
  let got: T | undefined;
  await serveAll(c, s.runId, async (j) => {
    if (memberKey(j) === "m1" && got === undefined) got = await probe(j, await tokenFor(c, j));
    await jobDone(c, j, ownMd(j));
  });
  expect(got).toBeDefined();
  return got as T;
}
/** Một run quy trình agent-đơn xong ⇒ id attachment output thật của run đó. */
async function otherRunOutputId(): Promise<string> {
  const s = await startInRoom(c, { key: SINGLE_DEF.key });
  await jobDone(c, await nextStageJob(c, s.runId), MD_AUTO);
  await waitStatus(c.sql, s.runId, "done");
  const o = (await outputs(c.sql, s.runId))[0];
  expect(o?.attachment_id).toBeTruthy();
  return o?.attachment_id as string;
}

describe("ID-01…04, 06 · tải id ngoài job ⇒ 401 một thân [AC-PB-04, PB-R18]", () => {
  it("AC-PB-04 · ID-01 · job thành viên run A tải attachment (upload) của run khác cùng tenant ⇒ 401", async () => {
    needSchema(c.ready);
    const f = await foreign("lan");
    const r = await withM1((j, t) => getAtt(c, j.id, f.id, t));
    expect({ status: r.status, json: r.json }).toEqual({ status: 401, json: UNAUTHORIZED });
  }, 40_000);

  it("AC-PB-04 · ID-02 · id thuộc tenant beta ⇒ 401, thân giống id ngẫu nhiên (ID-03) — không lộ tồn tại", async () => {
    needSchema(c.ready);
    const f = await foreign("an");
    const rnd = crypto.randomUUID();
    const r = await withM1(async (j, t) => ({
      beta: await getAtt(c, j.id, f.id, t),
      rnd: await getAtt(c, j.id, rnd, t),
    }));
    expect(r.beta.status).toBe(401);
    expect(r.beta.json).toEqual(UNAUTHORIZED);
    expect({ status: r.beta.status, json: r.beta.json }).toEqual({
      status: r.rnd.status,
      json: r.rnd.json,
    });
  }, 40_000);

  it("AC-PB-04 · ID-03 · uuid ngẫu nhiên không tồn tại ⇒ 401 UNAUTHORIZED", async () => {
    needSchema(c.ready);
    const r = await withM1((j, t) => getAtt(c, j.id, crypto.randomUUID(), t));
    expect({ status: r.status, json: r.json }).toEqual({ status: 401, json: UNAUTHORIZED });
  }, 40_000);

  it("AC-PB-04 · ID-04 · output THẬT (đã có blob) của process run khác cùng tenant ⇒ 401 với token job run này", async () => {
    needSchema(c.ready);
    const otherId = await otherRunOutputId();
    const r = await withM1((j, t) => getAtt(c, j.id, otherId, t));
    expect({ status: r.status, json: r.json }).toEqual({ status: 401, json: UNAUTHORIZED });
    expect(r.text).not.toContain("HD-12");
  }, 60_000);

  it("PB-R18 · ID-06 · token job acme tải attachment output của tenant beta ⇒ 401, thân không chứa nội dung", async () => {
    needSchema(c.ready);
    const f = await foreign("an", "output");
    const r = await withM1((j, t) => getAtt(c, j.id, f.id, t));
    expect({ status: r.status, json: r.json }).toEqual({ status: 401, json: UNAUTHORIZED });
    expect(r.text).not.toContain("bí mật");
  }, 40_000);
});

describe("ID-05 · guard khi ráp files: id ngoài run/tenant bị loại [PB-R18, AC-PB-04]", () => {
  /** Chạy `IDS_DEF` tới gate stage 0, đổi `attachment_id` output thành `badId` (SQL), duyệt ⇒ job stage 1. */
  async function jobAfterTamper(badId: string): Promise<{ job: Job; goodId: string }> {
    const s = await startInRoom(c, { key: IDS_DEF.key });
    await jobDone(c, await nextStageJob(c, s.runId), "## Bảng ý\nHD-12.\n\n## Số tiền\n12 000 000");
    await waitStatus(c.sql, s.runId, "waiting_review");
    const o0 = (await outputs(c.sql, s.runId)).find((o) => o.stage_idx === 0) as Json;
    const goodId = o0.attachment_id as string;
    await c.sql`update hub.process_outputs set attachment_id = ${badId} where id = ${o0.id}`;
    const t = await openTask(c.sql, s.runId, "review");
    expect((await review(c, "B", t?.id, { result: "pass" })).status).toBe(200);
    return { job: await nextStageJob(c, s.runId), goodId };
  }
  const idsOf = (j: Job): string[] =>
    ((j.payload.attachments ?? []) as { id: string }[]).map((a) => a.id);

  it("PB-R18 · ID-05 · output stage trước trỏ attachment tenant beta (SQL) ⇒ payload.attachments loại id đó; job stage 1 vẫn tạo", async () => {
    needSchema(c.ready);
    const f = await foreign("an", "output");
    const { job } = await jobAfterTamper(f.id);
    expect(job.payload.agent.id).toBeTruthy();
    expect(idsOf(job)).not.toContain(f.id);
  }, 60_000);

  it("PB-R18 · ID-05 · output stage trước trỏ attachment của process run khác cùng tenant (SQL) ⇒ payload.attachments loại id đó", async () => {
    needSchema(c.ready);
    const otherId = await otherRunOutputId();
    const { job } = await jobAfterTamper(otherId);
    expect(idsOf(job)).not.toContain(otherId);
  }, 80_000);

  it("PB-R18 · ID-05 · đối chứng: output đúng của chính run (không tamper) vẫn có trong payload.attachments", async () => {
    needSchema(c.ready);
    const s = await startInRoom(c, { key: IDS_DEF.key });
    await jobDone(c, await nextStageJob(c, s.runId), "## Bảng ý\nHD-12.\n\n## Số tiền\n12 000 000");
    await waitStatus(c.sql, s.runId, "waiting_review");
    const o0 = (await outputs(c.sql, s.runId)).find((o) => o.stage_idx === 0) as Json;
    const t = await openTask(c.sql, s.runId, "review");
    expect((await review(c, "B", t?.id, { result: "pass" })).status).toBe(200);
    expect(idsOf(await nextStageJob(c, s.runId))).toContain(o0.attachment_id as string);
  }, 60_000);
});
