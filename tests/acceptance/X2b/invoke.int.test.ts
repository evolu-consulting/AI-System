// HUB-FR-101 · HUB-BR-21 · AC-H26 · CHAT-AC-47/49/50 · X2b-R01–R06, R10, R14, R16 · test-plan X2b §4 I01–I14: gọi agent bằng
// `@` ở timeline chính — đúng 1 run theo người gọi, lỗi không lưu tin (Q4), usage người gọi, chặn vòng lặp (R01).
// Không đụng flow/thread (đang chờ người dùng chốt lại, test-plan §6).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { api, codeOf, mkGroup } from "../X2a/_x2a";
import {
  AGB,
  agentMsgs,
  answer,
  type CtxB,
  invoke,
  type Json,
  P,
  post,
  roomMsgCount,
  roomRuns,
  roomUsage,
  runCount,
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

/** Nhóm A (chủ) + B + E (`tam`). */
const group = async (name = "Nhóm kế toán") =>
  (await mkGroup(c.hub, await c.tok("lan"), [P.hoa.id, P.tam.id], name)).id as string;

describe("X2b-AC01 · A gọi @hoadon ở timeline [AC-H26, CHAT-AC-47]", () => {
  it("HUB-FR-101 · X2b-AC01 · đúng 1 run: runs.user_id=A, runs.room_id=phòng; 201 trả tin gọi + X-Run-Id/X-Flow-Id", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    expect(s.res.json.sender_type).toBe("user");
    expect(s.res.json.content).toBe("@hoadon kiểm tra");
    expect(s.flowId ?? "").toBe(s.res.json.flow_id ?? "?");
    const runs = await roomRuns(c.sql, room);
    expect(runs.map((r) => [r.id, r.user_id])).toEqual([[s.runId, P.lan.id]]);
  });

  it("HUB-FR-101 · X2b-AC01 · A và B đều thấy tin agent (sender_type agent, run_id, trigger_message_id, agent, caller A)", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
    await answer(c, s.runId, "Hoá đơn HD-12 hợp lệ.");
    for (const who of ["lan", "hoa"] as const) {
      const m = await waitAgentMsg(c, who, room, s.runId);
      expect(m?.trigger_message_id).toBe(s.res.json.id);
      expect(m?.content).toBe("Hoá đơn HD-12 hợp lệ.");
      expect(m?.agent?.key).toBe("hoadon");
      expect(m?.caller?.id).toBe(P.lan.id);
      expect(m?.run_status).toBe("finished");
      expect(m?.placement ?? "main").toBe("main");
    }
  });

  it("HUB-BR-21 · X2b-AC07 · usage tính A; B (không có hoadon) usage 0, vẫn thấy kết quả [CHAT-AC-50]", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon tổng hợp tháng 9");
    await answer(c, s.runId, "Tháng 9: 12 hoá đơn.");
    expect(await waitAgentMsg(c, "hoa", room, s.runId)).toBeDefined();
    expect(await roomUsage(c.sql, room, P.lan.id)).toBeGreaterThan(0);
    expect(await roomUsage(c.sql, room, P.hoa.id)).toBe(0);
  });

  it("HUB-FR-101 · X2b-R10 · GET /rooms/:id có active_runs khi đang chạy: caller A, agent hoadon, status running", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra lô 3");
    const r = await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${room}`);
    expect(r.status).toBe(200);
    const runs = (r.json.active_runs ?? []) as Json[];
    expect(runs.map((x) => [x.run_id, x.caller?.id, x.agent?.key, x.status])).toEqual([
      [s.runId, P.lan.id, "hoadon", "running"],
    ]);
  });
});

describe("X2b-AC02/AC14 · không có quyền → AGENT_NOT_FOUND, không run, không lưu tin (Q4) [CHAT-AC-49]", () => {
  it("HUB-FR-101 · X2b-AC02 · B gửi '@hoadon …' → 404 AGENT_NOT_FOUND {suggestions ⊆ AU B}, 0 run, tin không vào phòng", async () => {
    const room = await group();
    const before = await roomMsgCount(c.sql, room);
    const s = await post(c, "hoa", room, { content: "@hoadon kiểm tra giúp" });
    expect(codeOf(s.res)).toEqual({ status: 404, code: "AGENT_NOT_FOUND" });
    const sug = (s.res.json.error?.details?.suggestions ?? []) as string[];
    expect(sug).not.toContain("hoadon");
    expect(s.runId).toBeNull();
    expect(await runCount(c.sql, room)).toBe(0);
    expect(await roomMsgCount(c.sql, room)).toBe(before);
  });

  it("HUB-FR-101 · X2b-R04 · key không tồn tại và key không được dùng trả cùng một dạng lỗi (không lộ agent tồn tại)", async () => {
    const room = await group();
    const a = await post(c, "hoa", room, { content: "@hoadon xem" });
    const b = await post(c, "hoa", room, { content: "@khongco xem" });
    expect(codeOf(a.res)).toEqual({ status: 404, code: "AGENT_NOT_FOUND" });
    expect(codeOf(b.res)).toEqual(codeOf(a.res));
    expect(Object.keys(a.res.json.error ?? {}).sort()).toEqual(
      Object.keys(b.res.json.error ?? {}).sort(),
    );
  });

  it("HUB-BR-21 · X2b-AC14 · thu hồi hoadon của A trước khi gọi → AGENT_NOT_FOUND, 0 run", async () => {
    const room = await group();
    await c.sql`delete from hub.agent_grants where agent_id = ${AGB.hoadon} and subject_id = ${P.lan.id}`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    try {
      const s = await post(c, "lan", room, { content: "@hoadon kiểm tra" });
      expect(codeOf(s.res)).toEqual({ status: 404, code: "AGENT_NOT_FOUND" });
      expect(await runCount(c.sql, room)).toBe(0);
    } finally {
      await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${AGB.hoadon}, ${P.lan.tid}, 'user', ${P.lan.id}) on conflict do nothing`;
      await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    }
  });
});

describe("X2b-AC03/AC04/AC12 · điều kiện gọi (R01–R03)", () => {
  it("HUB-FR-101 · X2b-AC03 · không tag / tag giữa câu / '@@hoadon' → 201 tin thường, 0 run, không X-Run-Id", async () => {
    const room = await group();
    for (const content of ["chào cả nhà", "nhờ @hoadon xem giúp", "@@hoadon là tên agent"]) {
      const s = await post(c, "lan", room, { content });
      expect(s.res.status).toBe(201);
      expect(s.runId).toBeNull();
    }
    expect(await runCount(c.sql, room)).toBe(0);
    // Tin `@hoadon` hợp lệ cùng phòng tạo run ⇒ ca trên không xanh "nhờ" tính năng chưa có.
    await invoke(c, "lan", room, "@hoadon kiểm tra");
    expect(await runCount(c.sql, room)).toBe(1);
  });

  it("HUB-FR-101 · X2b-AC04 · tin hai tag '@hoadon @trello …' → đúng 1 run của A", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon @trello đối chiếu hoá đơn với thẻ");
    expect((await roomRuns(c.sql, room)).map((r) => r.id)).toEqual([s.runId]);
  });

  it("HUB-FR-101 · X2b-AC12 · tin agent chứa '@hoadon …' không sinh run (chặn vòng lặp R01)", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon nhắc việc");
    await answer(c, s.runId, "@hoadon kiểm tra lại toàn bộ");
    expect(await waitAgentMsg(c, "lan", room, s.runId)).toBeDefined();
    expect(await runCount(c.sql, room)).toBe(1);
    const items = agentMsgs(await timeline(c, "lan", room));
    expect(items.length).toBe(1);
  });
});

describe("X2b-AC08 · max_concurrent_runs của người gọi [FR-94]", () => {
  it("HUB-FR-94 · X2b-AC08 · A đã 2 run đang chạy → 429 TOO_MANY_RUNS + Retry-After 5, tin không lưu; B gọi @trello bình thường", async () => {
    const room = await group();
    await invoke(c, "lan", room, "@hoadon việc 1");
    await invoke(c, "lan", room, "@hoadon việc 2");
    const before = await roomMsgCount(c.sql, room);
    const s = await post(c, "lan", room, { content: "@hoadon việc 3" });
    expect(codeOf(s.res)).toEqual({ status: 429, code: "TOO_MANY_RUNS" });
    expect(s.res.headers.get("retry-after")).toBe("5");
    expect(await roomMsgCount(c.sql, room)).toBe(before);
    expect(await runCount(c.sql, room)).toBe(2);
    const b = await invoke(c, "hoa", room, "@trello tạo thẻ họp");
    const runs = await roomRuns(c.sql, room);
    expect(runs.find((r) => r.id === b.runId)?.user_id).toBe(P.hoa.id);
  });
});

describe("X2b-R16 · run lỗi", () => {
  it("HUB-FR-94 · X2b-R16 · job lỗi → tin agent run_status failed cho cả phòng, không lộ chi tiết lỗi", async () => {
    const room = await group();
    const s = await invoke(c, "lan", room, "@hoadon kiểm tra");
    const job = await c.rt.next(s.runId);
    await c.rt.fail(job, "UPSTREAM_ERROR", "LEAK-ERR-91 stacktrace");
    const m = await waitAgentMsg(c, "hoa", room, s.runId);
    expect(m?.run_status).toBe("failed");
    expect(JSON.stringify(m ?? {})).not.toContain("LEAK-ERR-91");
  });
});
