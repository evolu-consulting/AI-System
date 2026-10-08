// HUB-FR-101 · HUB-BR-21 · X2b-R06–R09, R20 · test-plan X2b §4 I20–I28 (hard-stop bảo mật, spec §9): ngữ cảnh run phòng =
// ≤ 20 tin gần nhất của timeline + tin gọi; không lấy phòng khác / hội thoại riêng; non-member không gọi/không thấy run;
// `GET/… /runs/:id*` chỉ người gọi (RLS runs); hội thoại nền ẩn khỏi `/conversations*` (D2); `attachment_ids` → 400 (AC11).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { R } from "../H1/_fixtures";
import { api, codeOf, e400, e404, mkGroup, say } from "../X2a/_x2a";
import {
  answer,
  type CtxB,
  invoke,
  type Json,
  P,
  post,
  roomRuns,
  runCount,
  settle,
  startX2b,
} from "./_x2b";

let c: CtxB;
let privateText = "";
beforeAll(async () => {
  c = await startX2b();
  const [m] = await c.sql<
    { content: string }[]
  >`select content from hub.messages where id = ${R.msgU1}`;
  privateText = m?.content ?? "";
}, 60_000);
afterEach(() => settle(c.sql));
afterAll(() => c?.stop());

const group = async (members: string[], name: string) =>
  (await mkGroup(c.hub, await c.tok("lan"), members, name)).id as string;

describe("X2b-AC09 · 20 tin gần nhất + tin gọi [R07, R08]", () => {
  it("HUB-FR-101 · X2b-AC09 · phòng 30 tin → history job đúng 20 tin (tin 11…30, cũ→mới), prompt = phần sau tag", async () => {
    const room = await group([P.hoa.id], "Nhóm 30 tin");
    const lan = await c.tok("lan");
    const hoa = await c.tok("hoa");
    for (let i = 1; i <= 30; i++) await say(c.hub, i % 2 ? lan : hoa, room, `tin ${i}`);
    const s = await invoke(c, "lan", room, "@hoadon tổng hợp giúp");
    const job = await c.rt.next(s.runId);
    const h = job.payload.history;
    const l = h.flatMap((x) => x.content.split("\n")); // mục liền nhau cùng role gộp bằng `\n` (plan §6)
    expect(l.length).toBe(20);
    expect(l[0]?.endsWith(": tin 11")).toBe(true);
    expect(l[19]?.endsWith(": tin 30")).toBe(true);
    expect(h.every((x) => x.role === "user")).toBe(true);
    expect(job.payload.prompt).toContain("tổng hợp giúp");
    expect(h.some((x) => x.content.includes("@hoadon tổng hợp giúp"))).toBe(false);
  });

  it("HUB-FR-101 · X2b-R08 · tin đến sau tin gọi không vào ngữ cảnh; tin agent trước đó vào với role assistant", async () => {
    const room = await group([P.hoa.id], "Nhóm cắt");
    await say(c.hub, await c.tok("hoa"), room, "trước khi hỏi");
    const s1 = await invoke(c, "lan", room, "@hoadon lần 1");
    await answer(c, s1.runId, "Kết quả lần 1.");
    await say(c.hub, await c.tok("hoa"), room, "sau lần 1");
    const s2 = await invoke(c, "lan", room, "@hoadon lần 2");
    await say(c.hub, await c.tok("hoa"), room, "SAU-TIN-GOI-2");
    const job = await c.rt.next(s2.runId);
    const contents = job.payload.history.flatMap((x) => x.content.split("\n"));
    expect(contents.some((t) => t.endsWith("trước khi hỏi"))).toBe(true);
    expect(
      job.payload.history.some((x) => x.role === "assistant" && x.content === "Kết quả lần 1."),
    ).toBe(true);
    expect(contents.some((t) => t.includes("SAU-TIN-GOI-2"))).toBe(false);
  });
});

describe("X2b-AC10 · rò ngữ cảnh / cách ly [BR-21, hard-stop]", () => {
  it("HUB-BR-21 · X2b-AC10 · không có tin phòng khác / hội thoại riêng của A trong history hay prompt", async () => {
    const other = await group([P.tam.id], "Phòng khác");
    await say(c.hub, await c.tok("lan"), other, "PHONG-KHAC-SECRET-31");
    const room = await group([P.hoa.id], "Phòng chính");
    await say(c.hub, await c.tok("hoa"), room, "tin phòng chính");
    const s = await invoke(c, "lan", room, "@hoadon tóm tắt");
    const job = await c.rt.next(s.runId);
    const all = JSON.stringify({ h: job.payload.history, p: job.payload.prompt });
    expect(all).toContain("tin phòng chính");
    expect(all).not.toContain("PHONG-KHAC-SECRET-31");
    expect(privateText.length).toBeGreaterThan(0);
    expect(all).not.toContain(privateText);
  });

  it("HUB-BR-21 · X2b-AC10 · C (có hoadon, không là thành viên) gửi '@hoadon …' → 404 ROOM_NOT_FOUND, 0 run (xanh trước code: hồi quy X2a)", async () => {
    const room = await group([P.hoa.id], "Phòng kín");
    const s = await post(c, "cuc", room, { content: "@hoadon kiểm tra" });
    expect(codeOf(s.res)).toEqual(e404);
    expect(s.runId).toBeNull();
    expect(await runCount(c.sql, room)).toBe(0);
  });

  it("HUB-BR-21 · X2b-AC10 · run phòng của A: B (thành viên) và C (ngoài) đều 404 ở /runs/:id/events, /cancel, /trace", async () => {
    const room = await group([P.hoa.id], "Phòng run");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    for (const who of ["hoa", "cuc"] as const) {
      const t = await c.tok(who);
      const ev = await api(c.hub, t, "GET", `/runs/${s.runId}/events`);
      const cancel = await api(c.hub, t, "POST", `/runs/${s.runId}/cancel`);
      const trace = await api(c.hub, t, "GET", `/runs/${s.runId}/trace`);
      expect([ev.status, cancel.status, trace.status]).toEqual([404, 404, 404]);
    }
    const [run] = await roomRuns(c.sql, room);
    expect(run?.status).toBe("running");
  });

  it("HUB-BR-21 · X2b-AC10 · C không thấy timeline / active_runs / tin agent của phòng (404)", async () => {
    const room = await group([P.hoa.id], "Phòng ẩn");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    await answer(c, s.runId, "AGENT-KQ-KIN-44");
    const t = await c.tok("cuc");
    expect(codeOf(await api(c.hub, t, "GET", `/rooms/${room}/messages`))).toEqual(e404);
    expect(codeOf(await api(c.hub, t, "GET", `/rooms/${room}`))).toEqual(e404);
  });

  it("HUB-BR-21 · X2b-AC10/D2 · hội thoại nền của run phòng không lộ qua /conversations* (404, không có trong danh sách)", async () => {
    const room = await group([P.hoa.id], "Phòng shim");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const [run] = await roomRuns(c.sql, room);
    const conv = run?.conversation_id as string;
    expect(run?.id).toBe(s.runId);
    const t = await c.tok("lan");
    const list = await api(c.hub, t, "GET", "/conversations?limit=100");
    expect(list.status).toBe(200);
    expect(((list.json.items ?? []) as Json[]).some((x) => x.id === conv)).toBe(false);
    expect((await api(c.hub, t, "GET", `/conversations/${conv}`)).status).toBe(404);
    const send = await api(c.hub, t, "POST", `/conversations/${conv}/messages`, {
      content: "vòng qua C1",
    });
    expect(send.status).toBe(404);
  });
});

describe("X2b-AC11 · đính kèm tách X2b-2 [Q9, D16]", () => {
  it("HUB-FR-101 · X2b-AC11 · attachment_ids vào tin phòng → 400 VALIDATION_ERROR, 0 run (xanh trước code: strict X2a)", async () => {
    const room = await group([P.hoa.id], "Phòng file");
    const s = await post(c, "lan", room, {
      content: "@hoadon đọc file",
      attachment_ids: ["a2bb0000-0000-4000-8000-000000009001"],
    });
    expect(codeOf(s.res)).toEqual(e400);
    expect(await runCount(c.sql, room)).toBe(0);
  });

  it("HUB-FR-101 · X2b-AC11 · run phòng không mang file (payload không có đính kèm)", async () => {
    const room = await group([P.hoa.id], "Phòng không file");
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    const p = job.payload as unknown as Json;
    expect(p.attachments).toBeUndefined();
  });
});
