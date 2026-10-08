// HUB-FR-101 · HUB-BR-21 · X2b-R02, R05, R07, R11, R13 · X2b-AC17 (viết lại lần 2) · test-plan X2b §4 I40–I47: thread chung —
// mọi thành viên nhắn được (không tag ⇒ 0 run), tag trong thread ⇒ run bằng quyền/quota người tag (thiếu ⇒ 404, không lưu),
// ngữ cảnh thread (≤ 50 tin, mọi người, kèm tên) + timeline trước tin gốc; `answer_run_id` chỉ người tag lượt đó.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { codeOf, mkGroup, say } from "../X2a/_x2a";
import {
  AGB,
  answer,
  type CtxB,
  invoke,
  P,
  post,
  roomMsgCount,
  roomRuns,
  roomUsage,
  runtimeUsage,
  settle,
  startX2b,
  timeline,
  waitAgentMsg,
} from "./_x2b";

let c: CtxB;
beforeAll(async () => {
  c = await startX2b();
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(() => c?.stop());

const ANF = { status: 404, code: "AGENT_NOT_FOUND" };
const NF = { status: 404, code: "NOT_FOUND" };
/** Nhóm A (chủ) + B (`hoa`, không hoadon) + C (`cuc`, có hoadon); A mở thread T bằng @hoadon, agent trả lời. */
async function thread(name: string, before: string[] = []) {
  const room = (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.cuc.id], name)).id as string;
  for (const t of before) await say(c.hub, await c.tok("hoa"), room, t);
  const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
  await answer(c, s.runId, "HD-12 hợp lệ.");
  expect(await waitAgentMsg(c, "lan", room, s.runId)).toBeDefined();
  return { room, T: s.flowId as string, s };
}

describe("X2b-AC17 · thread chung [R13 lần 2]", () => {
  it("HUB-FR-101 · X2b-AC17 · B (không hoadon) gửi 'ok' trong T → 201, 0 run, placement flow; A và C thấy trong ?flow_id=T, timeline không có", async () => {
    const { room, T } = await thread("Thread ok");
    const r = await post(c, "hoa", room, { content: "ok", flow_id: T });
    expect(r.res.status).toBe(201);
    expect(r.runId).toBeNull();
    expect(r.res.json.flow_id).toBe(T);
    expect(r.res.json.placement).toBe("flow");
    expect((await roomRuns(c.sql, room)).length).toBe(1);
    for (const who of ["lan", "cuc"] as const) {
      const items = await timeline(c, who, room, `?flow_id=${T}`);
      expect(items.some((m) => m.id === r.res.json.id)).toBe(true);
    }
    expect((await timeline(c, "lan", room)).some((m) => m.id === r.res.json.id)).toBe(false);
  });

  it("HUB-BR-21 · X2b-AC17 · B gửi '@hoadon …' trong T → 404 AGENT_NOT_FOUND, 0 run mới, tin không lưu (Q4)", async () => {
    const { room, T } = await thread("Thread B tag");
    const n = await roomMsgCount(c.sql, room);
    const r = await post(c, "hoa", room, { content: "@hoadon xem lại", flow_id: T });
    expect(codeOf(r.res)).toEqual(ANF);
    expect((await roomRuns(c.sql, room)).length).toBe(1);
    expect(await roomMsgCount(c.sql, room)).toBe(n);
  });

  it("HUB-BR-21 · X2b-AC17 · C tag '@hoadon tiếp' trong T → run mới user_id=C, usage C; ngữ cảnh có tin A, B (kèm tên) + timeline trước gốc, không phòng khác", async () => {
    const other = (await mkGroup(c.hub, await c.tok("cuc"), [], "Phòng riêng C")).id as string;
    await say(c.hub, await c.tok("cuc"), other, "PHONG-KHAC-C-19");
    const { room, T } = await thread("Thread C", ["TIMELINE-TRUOC-GOC"]);
    await post(c, "hoa", room, { content: "B-TRONG-THREAD", flow_id: T });
    const r = await post(c, "cuc", room, { content: "@hoadon tiếp", flow_id: T });
    expect(r.res.status).toBe(201);
    expect(r.runId ?? "").not.toBe("");
    const runs = await roomRuns(c.sql, room);
    expect(runs.find((x) => x.id === r.runId)?.user_id).toBe(P.cuc.id);
    const job = await c.rt.next(r.runId as string);
    const l = job.payload.history.flatMap((x) => x.content.split("\n"));
    expect(l.some((x) => x.endsWith(": TIMELINE-TRUOC-GOC"))).toBe(true);
    expect(
      l.some((x) => x.endsWith(": B-TRONG-THREAD") && x.length > ": B-TRONG-THREAD".length),
    ).toBe(true);
    expect(l.some((x) => x.endsWith("kiểm tra HD-12"))).toBe(true);
    expect(JSON.stringify(job.payload)).not.toContain("PHONG-KHAC-C-19");
    await runtimeUsage(c, job);
    await c.rt.agent(job, { status: "done", text: "Đã xem tiếp." });
    expect(await waitAgentMsg(c, "lan", room, r.runId as string, 8_000, T)).toBeDefined();
    expect(await roomUsage(c.sql, room, P.cuc.id)).toBeGreaterThan(0);
  });

  it("HUB-FR-95 · X2b-AC17 · run C chờ side_effect: A gửi answer_run_id → 403 NOT_RUN_CALLER; C gửi (không tag) → 201 run mới của C", async () => {
    const { room, T } = await thread("Thread xác nhận");
    const r = await post(c, "cuc", room, { content: "@hoadon tạo thẻ", flow_id: T });
    const runC = r.runId ?? "";
    expect(runC).not.toBe("");
    const job = await c.rt.next(runC);
    const [run] = await c.sql<
      { flow_id: string }[]
    >`select flow_id from hub.runs where id = ${runC}`;
    await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${P.cuc.tid}, ${P.cuc.id}, ${run?.flow_id ?? runC}, ${runC}, ${AGB.hoadon},
        'a2bb0000-0000-4000-8000-000000008002', 'pending')`;
    await c.rt.agent(job, { status: "done", text: "Xác nhận tạo thẻ PARAM-C-88?" });
    expect(await waitAgentMsg(c, "lan", room, runC, 8_000, T)).toBeDefined();
    const a = await post(c, "lan", room, { content: "Đồng ý", flow_id: T, answer_run_id: runC });
    expect(codeOf(a.res)).toEqual({ status: 403, code: "NOT_RUN_CALLER" });
    const ok = await post(c, "cuc", room, { content: "Đồng ý", flow_id: T, answer_run_id: runC });
    expect(ok.res.status).toBe(201);
    expect((await roomRuns(c.sql, room)).find((x) => x.id === ok.runId)?.user_id).toBe(P.cuc.id);
  });

  it("HUB-FR-101 · X2b-AC17 · T có 60 tin → ngữ cảnh lượt tag đúng 50 tin thread gần nhất", async () => {
    const { room, T } = await thread("Thread 60");
    for (let i = 1; i <= 58; i++)
      await post(c, i % 2 ? "hoa" : "lan", room, { content: `t ${i}`, flow_id: T });
    const r = await post(c, "cuc", room, { content: "@hoadon tóm tắt thread", flow_id: T });
    expect(r.runId ?? "").not.toBe("");
    const job = await c.rt.next(r.runId as string);
    const l = job.payload.history.flatMap((x) => x.content.split("\n"));
    expect(l.length).toBe(50);
    expect(l[0]?.endsWith(": t 9")).toBe(true);
    expect(l[49]?.endsWith(": t 58")).toBe(true);
  });

  it("HUB-BR-21 · X2b-AC10 · flow_id của phòng khác / id lạ → 404 NOT_FOUND; answer_run_id thiếu flow_id → 400", async () => {
    const a = await thread("Thread phòng 1");
    const b = await thread("Thread phòng 2");
    expect(codeOf((await post(c, "lan", a.room, { content: "lạc", flow_id: b.T })).res)).toEqual(
      NF,
    );
    const rnd = "a2bb0000-0000-4000-8000-000000008777";
    expect(codeOf((await post(c, "lan", a.room, { content: "lạc", flow_id: rnd })).res)).toEqual(
      NF,
    );
    const bad = await post(c, "lan", a.room, { content: "x", answer_run_id: a.s.runId });
    expect(codeOf(bad.res)).toEqual({ status: 400, code: "VALIDATION_ERROR" });
  });
});
