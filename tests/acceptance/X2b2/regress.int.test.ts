// HUB-FR-44 · HUB-BR-28 · X2b2-R20, R22, D8, S3b, S7, S8 · test-plan X2b2 §3.2 I21 + §3.7 I51–I54 (hub có engine P-a:
// `processEngine`, vòng nền tắt, `stageLauncher` giả): `!quy-trình` ở timeline kèm file ⇒ 400 path `attachment_ids`, file chưa
// gắn; `!` không file giữ P-a; log không chứa tên file; file phòng KHÔNG làm input `file` của `POST /process-runs` (S8);
// endpoint nội bộ sau khi xoá phòng ⇒ 401 (S3b). Quy trình `hoa-don` (1 stage auto, input `doc` kiểu file) tạo qua
// `POST /process-defs` (tenant_admin), như P-b `pfs3/_local.ts` `mkDef`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { defInput, stageDef } from "../P-a/_support/process-fixtures";
import { captureLogs, codeOf } from "../X2a/_x2a";
import { AGB, invoke, settle } from "../X2b/_x2b";
import {
  type CtxX,
  call,
  deleteRoom,
  dropUnbound,
  group,
  HOADON,
  jobFetch,
  pdf,
  roomFiles,
  sendFiles,
  sendRoom,
  startX2b2,
  sweep,
  uploadId,
  waitRunStatus,
} from "./_x2b2";

let c: CtxX;
beforeAll(async () => {
  c = await startX2b2({ processEngine: true });
  const stages = [
    {
      ...stageDef({ key: "doc", name: "Đọc hoá đơn", after: { kind: "auto" } }),
      executor: { kind: "agent", agent_id: AGB.hoadon },
      sources: [],
      must_know: [],
    },
  ];
  const body = {
    ...defInput({ key: "hoa-don", name: "Hoá đơn X2b2", stages }),
    sources: [],
    inputs: [{ key: "doc", label: "Tài liệu hoá đơn", type: "file", required: false }],
  };
  const r = await call(c, "tadmin", "POST", "/process-defs", body);
  if (r.status !== 201)
    throw new Error(`FIXTURE SAI POST /process-defs hoa-don: ${r.status} ${r.text.slice(0, 300)}`);
}, 60_000);
afterEach(async () => {
  await c.sql`update hub.process_runs set status = 'cancelled', finished_at = now()
    where status in ('running', 'waiting_review', 'waiting_answer', 'needs_decision')`;
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(() => c?.stop());

const nProcessRuns = async () =>
  (await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs`)[0]?.n ?? -1;

describe("X2b2-AC16 · `!quy-trình` + file [R20, D8]", () => {
  it("HUB-BR-28 · X2b2-AC16 · I21 · engine bật, G1 '!hoa-don HD-12' + id ⇒ 400 VALIDATION_ERROR (attachment_ids); file chưa gắn; 0 process-run; đối chứng tin thường + id ⇒ 201", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I21");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    const n = await nProcessRuns();
    const s = await sendRoom(c, "lan", g1, { content: "!hoa-don HD-12", attachment_ids: [id] });
    expect(codeOf(s.res)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(JSON.stringify(s.res.json?.error ?? {})).toContain("attachment_ids");
    expect(await nProcessRuns()).toBe(n);
    expect(await roomFiles(c.sql, g1)).toEqual([]);
    await sendFiles(c, "lan", g1, "chứng từ HD-12", [id]);
    expect((await roomFiles(c.sql, g1)).map((f) => f.id)).toEqual([id]);
  });

  it("HUB-BR-28 · X2b2-AC16 · I51 · '!hoa-don HD-51' KHÔNG file (engine bật) ⇒ P-a như cũ: 201 + X-Process-Run-Id, +1 process-run (hồi quy)", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I51");
    const n = await nProcessRuns();
    const s = await sendRoom(c, "lan", g1, { content: "!hoa-don HD-51" });
    expect(s.res.status).toBe(201);
    expect(s.res.headers.get("x-process-run-id") ?? "").not.toBe("");
    expect(await nProcessRuns()).toBe(n + 1);
  });
});

describe("X2b2-AC16 · log không có tên file [R22, S7]", () => {
  it("HUB-FR-44 · X2b2-AC16 · I52 · gửi file, id sai, run đọc file, xoá phòng + sweep ⇒ không dòng log nào chứa hoadon.pdf / phongkhac.pdf", async () => {
    const log = captureLogs();
    try {
      const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I52");
      const g2 = await group(c, "lan", ["cuc"], "Phòng khác I52");
      const id = await uploadId(c, "lan", "hoadon.pdf", HOADON());
      await sendFiles(c, "lan", g1, "đây là hoá đơn", [id]);
      const other = await uploadId(c, "lan", "phongkhac.pdf", pdf(2048));
      await sendFiles(c, "lan", g2, "tệp phòng khác", [other]);
      expect(
        (await sendRoom(c, "lan", g1, { content: "x", attachment_ids: [other] })).res.status,
      ).toBe(404);
      const s = await invoke(c, "lan", g1, "@hoadon kiểm tra file");
      const job = await c.rt.next(s.runId);
      expect((await jobFetch(c, job, id)).status).toBe(200);
      expect((await deleteRoom(c, "lan", g1)).status).toBe(204);
      await sweep(c, new Date(Date.now() + 60_000));
      const dump = log.lines.join("\n");
      expect(dump).not.toContain("hoadon.pdf");
      expect(dump).not.toContain("phongkhac.pdf");
    } finally {
      log.restore();
    }
  });
});

describe("Security S8, S3b [plan §11]", () => {
  it("HUB-BR-22 · X2b2-R06 · I53 · file phòng (G1) làm input `file` của POST /process-runs ⇒ 400 VALIDATION_ERROR path inputs; 0 process-run; đối chứng file chưa gắn ⇒ 201", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I53");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    await sendFiles(c, "lan", g1, "đây là hoá đơn", [id]);
    expect((await roomFiles(c.sql, g1)).map((f) => f.id)).toEqual([id]);
    const start = (attachment_id: string) =>
      call(c, "lan", "POST", "/process-runs", {
        process_key: "hoa-don",
        input: "HD-53",
        origin: { kind: "none" },
        inputs: [{ type: "file", key: "doc", attachment_id }],
      });
    const n = await nProcessRuns();
    const r = await start(id);
    expect(codeOf(r)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
    expect(JSON.stringify(r.json?.error?.details ?? {})).toContain('"inputs"');
    expect(await nProcessRuns()).toBe(n);
    const [leak] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.jobs
      where payload::text like ${`%${id}%`}`;
    expect(leak?.n).toBe(0);
    const free = await uploadId(c, "lan", "chuagan.pdf", pdf(2048));
    expect((await start(free)).status).toBe(201);
  });

  it("HUB-BR-22 · X2b2-R13 · I54 · DELETE G1 khi run đang chạy ⇒ jobFetch bằng token job ⇒ 401 (đối chứng trước xoá: 200)", async () => {
    const g1 = await group(c, "lan", ["hoa"], "Phòng hoá đơn I54");
    const id = await uploadId(c, "lan", "hoadon.pdf", pdf(2048));
    await sendFiles(c, "lan", g1, "đây là hoá đơn", [id]);
    const s = await invoke(c, "lan", g1, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    expect((await jobFetch(c, job, id)).status).toBe(200);
    expect((await deleteRoom(c, "lan", g1)).status).toBe(204);
    await waitRunStatus(c.sql, s.runId, ["cancelled", "failed", "finished"]);
    expect((await jobFetch(c, job, id)).status).toBe(401);
  });
});
