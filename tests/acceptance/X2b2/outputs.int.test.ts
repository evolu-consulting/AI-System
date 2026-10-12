// HUB-FR-101 · WRK-FR-18 · X2b2-R11, R12, R16, D11, S6 · test-plan X2b2 §3.5 I42–I46: `out/` của run phòng (agent ghi qua
// `POST /internal/jobs/:id/outputs` bằng token job — `jobOutput`) gắn vào TIN AGENT của phòng (`room_message_id =
// runs.answer_message_id`, `user_id` = người tag, `origin=output`), không vào hội thoại nền; mọi thành viên tải được; run
// lỗi/huỷ ⇒ không gắn; trần 5 file/job (H2c-R26). Đỏ trước code: output gắn vào `hub.messages` hội thoại nền (SseWriter H2c).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { codeOf, msgEv, openMeStream } from "../X2a/_x2a";
import { invoke, P, settle, waitAgentMsg } from "../X2b/_x2b";
import {
  attCols,
  type CtxX,
  call,
  dropUnbound,
  finishWith,
  getContent,
  group,
  type Job,
  type Json,
  jobOutput,
  jobOutputRaw,
  startX2b2,
  text,
  waitRunStatus,
} from "./_x2b2";

let c: CtxX;
beforeAll(async () => {
  c = await startX2b2();
}, 60_000);
afterEach(async () => {
  await settle(c.sql);
  await dropUnbound(c.sql);
});
afterAll(() => c?.stop());

const MD = text("# Báo cáo\n\nĐã kiểm tra hoá đơn.\n");
type OutRun = { room: string; runId: string; job: Job; outs: string[] };
/** G1 {A, B}; A '@hoadon xem'; job ghi `names` vào out/ (endpoint thật). */
async function runWithOutputs(name: string, names: string[]): Promise<OutRun> {
  const room = await group(c, "lan", ["hoa"], name);
  const s = await invoke(c, "lan", room, "@hoadon xem");
  const job = await c.rt.next(s.runId);
  const outs: string[] = [];
  for (const n of names) outs.push(await jobOutput(c, job, n, MD));
  return { room, runId: s.runId, job, outs };
}
async function answerId(runId: string): Promise<string | null> {
  const [r] = await c.sql<
    { id: string | null }[]
  >`select answer_message_id as id from hub.runs where id = ${runId}`;
  return r?.id ?? null;
}

describe("X2b2-AC10 · out/ lên tin agent của phòng [R11, R12, D11]", () => {
  it("HUB-FR-101 · X2b2-AC10 · I42 · report.md ⇒ tin agent attachments=[report.md]; hàng room_id=G1, room_message_id=answer_message_id, user_id=A, origin=output; B tải 200, C 404", async () => {
    const r = await runWithOutputs("Phòng hoá đơn I42", ["report.md"]);
    const out = r.outs[0] as string;
    await finishWith(c, r.job, "Đã ghi báo cáo.", [out]);
    await waitRunStatus(c.sql, r.runId, ["finished"]);
    const msg = await waitAgentMsg(c, "hoa", r.room, r.runId);
    expect(msg?.attachments).toEqual([
      { id: out, filename: "report.md", mime: "text/markdown", size: MD.length, available: true },
    ]);
    const ans = await answerId(r.runId);
    expect(msg?.id).toBe(ans);
    const row = await attCols(c.sql, out);
    expect({
      room_id: row?.room_id,
      room_message_id: row?.room_message_id,
      user_id: row?.user_id,
      origin: row?.origin,
      message_id: row?.message_id,
      conversation_id: row?.conversation_id,
      flow_id: row?.flow_id,
    }).toEqual({
      room_id: r.room,
      room_message_id: ans,
      user_id: P.lan.id,
      origin: "output",
      message_id: null,
      conversation_id: null,
      flow_id: null,
    });
    expect((await getContent(c, "hoa", out)).status).toBe(200);
    expect(codeOf(await getContent(c, "cuc", out))).toEqual({ status: 404, code: "NOT_FOUND" });
  });

  it("HUB-FR-101 · X2b2-AC10 · I43 · cùng run: file KHÔNG gắn vào hub.messages của hội thoại nền", async () => {
    const r = await runWithOutputs("Phòng hoá đơn I43", ["report.md"]);
    const out = r.outs[0] as string;
    await finishWith(c, r.job, "Đã ghi báo cáo.", [out]);
    await waitRunStatus(c.sql, r.runId, ["finished"]);
    expect(await waitAgentMsg(c, "lan", r.room, r.runId)).toBeDefined();
    const [m] = await c.sql<{ n: number }[]>`select count(*)::int as n from hub.attachments a
      join hub.messages m on m.id = a.message_id where a.id = ${out}`;
    expect(m?.n).toBe(0);
    expect((await attCols(c.sql, out))?.room_id).toBe(r.room);
  });

  it("HUB-FR-101 · X2b2-AC10 · I44 · run failed sau khi ghi out/ ⇒ không gắn (room_id NULL); A huỷ run ⇒ không gắn", async () => {
    const f = await runWithOutputs("Phòng hoá đơn I44a", ["loi.md"]);
    await c.rt.fail(f.job, "UPSTREAM_ERROR", "lỗi thử I44");
    await waitRunStatus(c.sql, f.runId, ["failed"]);
    const k = await runWithOutputs("Phòng hoá đơn I44b", ["huy.md"]);
    expect((await call(c, "lan", "POST", `/runs/${k.runId}/cancel`)).status).toBeLessThan(300);
    await waitRunStatus(c.sql, k.runId, ["cancelled"]);
    for (const id of [f.outs[0], k.outs[0]] as string[]) {
      const row = await attCols(c.sql, id);
      expect({ id, room: row?.room_id ?? null, msg: row?.message_id ?? null }).toEqual({
        id,
        room: null,
        msg: null,
      });
    }
    // đối chứng (đỏ trước code): run finished thì gắn phòng
    const ok = await runWithOutputs("Phòng hoá đơn I44c", ["xong.md"]);
    await finishWith(c, ok.job, "Xong.", ok.outs);
    await waitRunStatus(c.sql, ok.runId, ["finished"]);
    expect(await waitAgentMsg(c, "lan", ok.room, ok.runId)).toBeDefined();
    expect((await attCols(c.sql, ok.outs[0] as string))?.room_id).toBe(ok.room);
  });

  it("HUB-FR-101 · X2b2-R11 · I45 · jobOutput 6 file ⇒ 5 nhận (thứ 6 409), 5 file gắn tin agent", async () => {
    const r = await runWithOutputs("Phòng hoá đơn I45", [
      "o1.md",
      "o2.md",
      "o3.md",
      "o4.md",
      "o5.md",
    ]);
    const sixth = await jobOutputRaw(c, r.job, "o6.md", MD);
    expect(codeOf(sixth)).toEqual({ status: 409, code: "ATTACHMENT_QUOTA_EXCEEDED" });
    await finishWith(c, r.job, "Đã ghi 5 tệp.", r.outs);
    await waitRunStatus(c.sql, r.runId, ["finished"]);
    const msg = await waitAgentMsg(c, "lan", r.room, r.runId);
    expect((msg?.attachments ?? []).map((a: Json) => a.filename).sort()).toEqual([
      "o1.md",
      "o2.md",
      "o3.md",
      "o4.md",
      "o5.md",
    ]);
  });

  it("HUB-FR-99 · X2b2-R16 · I46 · B nghe /me/stream ⇒ room.message tin agent có attachments", async () => {
    const r = await runWithOutputs("Phòng hoá đơn I46", ["bao-cao.md"]);
    const s = await openMeStream(c.hub, await c.tok("hoa"));
    try {
      await finishWith(c, r.job, "Báo cáo I46.", r.outs);
      const ev = await s.until(msgEv("Báo cáo I46."), 8_000);
      expect(ev?.valid).toBe(true);
      expect(ev?.data?.message?.attachments?.map((a: Json) => a.id)).toEqual(r.outs);
    } finally {
      s.close();
    }
  });
});
