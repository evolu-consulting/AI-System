// CR-121 · R-1 · cr121-r1-run-control · điều khiển lượt chạy trên hub THẬT (launcher PF1 + runtime giả), mẫu `p-auto` 2 stage auto:
// (1) Dừng: task/timer đóng, run cancelled, audit người+lý do; bấm 2 lần (đồng thời) ⇒ 1 audit; kết quả job muộn KHÔNG ghi đè;
// (2) quyền: thành viên 403, tenant_admin tenant khác 404; (3) Chạy lại bước (platform_admin) trên run xong ⇒ cùng run chạy lại từ
// bước đó, vòng tăng, kết quả cũ giữ; tenant_admin 403; bấm 2 lần đồng thời ⇒ 1 lần quay lại; (4) Chạy lại cả lượt ⇒ run mới
// `rerun_of`, cùng snapshot + input; 2 lần đồng thời ⇒ 1 run mới; run đang chạy ⇒ 409.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Json, T } from "../P-a/_support/pa";
import { needSchema } from "../P-a/_support/schema";
import {
  type CtxPf1,
  jobDone,
  MD_AUTO,
  nextStageJob,
  outputs,
  runRow,
  stageRow,
  startApi,
  startPf1,
  waitStatus,
} from "../P-a/pf1/_local";

let c: CtxPf1;
beforeAll(async () => {
  c = await startPf1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const TO = 60_000;
type R = "A" | "Adm" | "P" | "Db";
/** platform_admin thao tác run của tenant khác qua `?tenant_id` (như cancel/decide/view). */
const tq = (r: R) => (r === "P" ? `?tenant_id=${T.acme}` : "");
const stop = (r: R, id: string, reason = "sent_by_mistake") =>
  c.call(r, "POST", `/process-runs/${id}/stop${tq(r)}`, { reason });
const rerunStep = (r: R, id: string, stageIdx: number, reason = "bad_data") =>
  c.call(r, "POST", `/process-runs/${id}/rerun-step${tq(r)}`, { reason, stage_idx: stageIdx });
const rerun = (r: R, id: string, reason = "needs_edit") =>
  c.call(r, "POST", `/process-runs/${id}/rerun`, { reason });
const audits = (id: string) =>
  c.sql<Json[]>`select action, actor_id, actor_role, summary from hub.audit_log
    where entity = 'process_run' and entity_id = ${id} and summary ? 'op' order by seq`;

async function start(): Promise<string> {
  const s = await startApi(c, { key: "p-auto", input: "HD-R1" });
  expect(s.status).toBe(201);
  return s.json?.id as string;
}
/** Chạy hết 2 stage ⇒ run `done`. */
async function toDone(): Promise<string> {
  const id = await start();
  for (let i = 0; i < 2; i++) await jobDone(c, await nextStageJob(c, id), MD_AUTO);
  await waitStatus(c.sql, id, "done");
  return id;
}

describe("CR-121 R-1 · Dừng / Chạy lại bước / Chạy lại cả lượt", () => {
  it(
    "Dừng: tenant_admin dừng run đang chạy hai lần đồng thời ⇒ cancelled, một audit, job trả muộn không ghi đè",
    async () => {
      needSchema(c.ready);
      const id = await start();
      const job = await nextStageJob(c, id); // worker đang chạy bước 0
      const [a, b] = await Promise.all([stop("Adm", id), stop("Adm", id)]);
      expect([a.status, b.status]).toEqual([200, 200]);
      expect([a.json?.status, b.json?.status]).toEqual(["cancelled", "cancelled"]);
      const au = await audits(id);
      expect(au.length).toBe(1);
      expect(au[0]).toMatchObject({ action: "cancel", actor_role: "tenant_admin" });
      expect(au[0]?.summary).toMatchObject({ op: "stop", reason: "sent_by_mistake" });
      expect((await runRow(c.sql, id)).cancelled_by).toBeTruthy();
      // Kết quả job đến SAU khi dừng ⇒ driver bỏ: run vẫn cancelled, bước không done, không output.
      await jobDone(c, job, MD_AUTO).catch(() => {});
      await (c.hub.handles() as { settled?: () => Promise<void> } | null)?.settled?.();
      expect((await runRow(c.sql, id)).status).toBe("cancelled");
      expect((await stageRow(c.sql, id, 0)).status).toBe("cancelled");
      expect((await outputs(c.sql, id)).length).toBe(0);
      // Bấm lại sau đó ⇒ cùng kết quả, không thêm audit.
      expect((await stop("P", id)).status).toBe(200);
      expect((await audits(id)).length).toBe(1);
    },
    TO,
  );

  it(
    "Quyền: thành viên 403, tenant_admin tenant khác 404, tenant_admin chạy lại bước 403",
    async () => {
      needSchema(c.ready);
      const id = await start();
      expect((await stop("A", id)).status).toBe(403);
      expect((await stop("Db", id)).status).toBe(404);
      expect((await rerun("Db", id)).status).toBe(404);
      expect((await rerunStep("Adm", id, 0)).status).toBe(403);
      expect((await rerunStep("Db", id, 0)).status).toBe(403);
      expect((await rerun("Adm", id)).status).toBe(409); // đang chạy ⇒ chưa chạy lại cả lượt
      expect((await runRow(c.sql, id)).status).toBe("running");
      const bad = await c.call("Adm", "POST", `/process-runs/${id}/stop`, {});
      expect(bad.status).toBe(400); // lý do bắt buộc
      expect((await stop("Adm", id)).status).toBe(200);
    },
    TO,
  );

  it(
    "Chạy lại bước: platform_admin trên run xong hai lần đồng thời ⇒ một lần quay lại, cùng run, kết quả cũ giữ",
    async () => {
      needSchema(c.ready);
      const id = await toDone();
      const before = (await outputs(c.sql, id)).length;
      const [x, y] = await Promise.all([rerunStep("P", id, 1), rerunStep("P", id, 1)]);
      expect([x.status, y.status].sort()).toEqual([200, 409]);
      // Một lần chạy lại: đúng một audit `rerun_step`; không ghi "quay lại" của người duyệt.
      expect((await audits(id)).filter((a) => a.summary?.op === "rerun_step").length).toBe(1);
      const ev = await c.sql<
        Json[]
      >`select 1 from hub.process_back_events where process_run_id = ${id}`;
      expect(ev.length).toBe(0);
      const run = await runRow(c.sql, id);
      expect({ st: run.status, fin: run.finished_at, step: run.current_step }).toEqual({
        st: "running",
        fin: null,
        step: 1,
      });
      expect((await stageRow(c.sql, id, 0)).status).toBe("done"); // bước trước giữ nguyên
      const s1 = await stageRow(c.sql, id, 1);
      expect({ round: s1.round > 1, st: ["queued", "running"].includes(s1.status) }).toEqual({
        round: true,
        st: true,
      });
      const au = await audits(id);
      expect(au.at(-1)).toMatchObject({ action: "start", actor_role: "platform_admin" });
      expect(au.at(-1)?.summary).toMatchObject({
        op: "rerun_step",
        reason: "bad_data",
        stage_idx: 1,
      });
      await jobDone(c, await nextStageJob(c, id), MD_AUTO);
      await waitStatus(c.sql, id, "done");
      expect((await outputs(c.sql, id)).length).toBe(before + 1); // kết quả cũ còn, thêm bản mới
    },
    TO,
  );

  it(
    "Chạy lại cả lượt: run đã dừng, hai lần đồng thời ⇒ một run mới rerun_of cùng snapshot + input",
    async () => {
      needSchema(c.ready);
      const id = await start();
      expect((await stop("Adm", id)).status).toBe(200);
      expect((await rerunStep("P", id, 0)).status).toBe(409); // đã dừng ⇒ không chạy lại bước
      const [a, b] = await Promise.all([rerun("Adm", id), rerun("Adm", id)]);
      expect([a.status, b.status].sort()).toEqual([200, 201]);
      expect(a.json?.id).toBe(b.json?.id);
      const nid = a.json?.id as string;
      expect(nid).not.toBe(id);
      const rows = await c.sql<Json[]>`select id from hub.process_runs where rerun_of = ${id}`;
      expect(rows.map((r) => r.id)).toEqual([nid]);
      const [o, n] = [await runRow(c.sql, id), await runRow(c.sql, nid)];
      expect({ snap: n.snapshot, input: n.input, by: n.started_by, def: n.process_def_id }).toEqual(
        {
          snap: o.snapshot,
          input: o.input,
          by: o.started_by,
          def: o.process_def_id,
        },
      );
      expect((await audits(nid))[0]?.summary).toMatchObject({
        op: "rerun",
        reason: "needs_edit",
        rerun_of: id,
      });
      // Run mới chạy thật tới xong.
      for (let i = 0; i < 2; i++) await jobDone(c, await nextStageJob(c, nid), MD_AUTO);
      await waitStatus(c.sql, nid, "done");
    },
    TO,
  );
});
