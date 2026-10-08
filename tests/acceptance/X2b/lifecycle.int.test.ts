// HUB-FR-101 · HUB-BR-21 · HUB-BR-22 · X2b-R17, AC14, Q8, Q2/D15 · test-plan X2b §5 (I60–I66): vòng đời run phòng khi
// thành viên/phòng/quyền đổi giữa chừng (plan §1 D15, §4.2 `room_post_agent_message`, §5 hàng Rời/bớt/xoá).
// Phòng do B (`hoa`) làm chủ, A (`lan`) gọi agent, E (`tam`) thành viên. Run "đang chạy" = job đã claim (`rt.next`).
// Runtime giả trả kết quả muộn SAU khi run bị huỷ (mô phỏng kết quả về trễ) — hub phải bỏ qua, không đăng tin vào phòng.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { api, type MeStream, mkGroup, openMeStream } from "../X2a/_x2a";
import {
  AGB,
  answer,
  type CtxB,
  invoke,
  type Job,
  P,
  post,
  settle,
  startX2b,
  waitAgentMsg,
  waitFor,
} from "./_x2b";

let c: CtxB;
const streams: MeStream[] = [];
beforeAll(async () => {
  c = await startX2b();
}, 60_000);
afterEach(async () => {
  for (const s of streams.splice(0)) s.close();
  await settle(c.sql);
});
afterAll(() => c?.stop());

/** Phòng nhóm B làm chủ, thành viên A, E. */
const groupB = async (name: string) =>
  (await mkGroup(c.hub, await c.tok("hoa"), [P.lan.id, P.tam.id], name)).id as string;
const runStatus = async (runId: string) =>
  (await c.sql<{ status: string }[]>`select status from hub.runs where id = ${runId}`)[0]?.status;
/** Chờ run rời `running` (≤ ms); trả trạng thái cuối. */
const settled = (runId: string, ms = 8_000) =>
  waitFor(
    () => runStatus(runId),
    (s) => s !== undefined && s !== "running",
    ms,
  );
const agentRows = async (runId: string) =>
  (
    await c.sql<
      { n: number }[]
    >`select count(*)::int as n from hub.room_messages where run_id = ${runId} and sender_type = 'agent'`
  )[0]?.n ?? 0;
/** Kết quả trễ của Runtime sau khi run bị huỷ: lỗi (job không còn running) là chấp nhận. */
async function lateResult(job: Job): Promise<void> {
  try {
    await c.rt.agent(job, { status: "done", text: "KET-QUA-TRE-55" });
  } catch {
    // job đã huỷ — Runtime thật cũng không ghi được
  }
}
/** A gọi `@hoadon` trong phòng B, Runtime claim job (run đang chạy). */
async function running(room: string) {
  const s = await invoke(c, "lan", room, "@hoadon kiểm tra HD-12");
  const job = await c.rt.next(s.runId);
  return { s, job };
}

describe("X2b-R17 · Q8 · người gọi rời / bị bớt / phòng xoá giữa chừng ⇒ huỷ run, không ghi tin vào phòng", () => {
  it("HUB-BR-22 · X2b-R17 · A rời phòng khi run chạy ⇒ run cancelled, 0 tin agent (kể cả kết quả trễ)", async () => {
    const room = await groupB("Nhóm A rời");
    const { s, job } = await running(room);
    expect((await api(c.hub, await c.tok("lan"), "POST", `/rooms/${room}/leave`)).status).toBe(204);
    expect(await settled(s.runId)).toBe("cancelled");
    await lateResult(job);
    expect(await agentRows(s.runId)).toBe(0);
  });

  it("HUB-BR-22 · X2b-R17 · B bớt A khi run chạy ⇒ run cancelled; E nhận room.run_finished {cancelled, message_id null}", async () => {
    const room = await groupB("Nhóm bớt A");
    const se = await openMeStream(c.hub, await c.tok("tam"));
    streams.push(se);
    const { s, job } = await running(room);
    const del = await api(
      c.hub,
      await c.tok("hoa"),
      "DELETE",
      `/rooms/${room}/members/${P.lan.id}`,
    );
    expect(del.status).toBe(204);
    expect(await settled(s.runId)).toBe("cancelled");
    await lateResult(job);
    const fin = await se.until(
      (e) => e.event === "room.run_finished" && e.data?.run_id === s.runId,
      5_000,
    );
    expect({
      status: fin?.data?.status,
      message_id: fin?.data?.message_id,
      rows: await agentRows(s.runId),
    }).toEqual({ status: "cancelled", message_id: null, rows: 0 });
  });

  it("HUB-BR-22 · X2b-R17 · B xoá phòng khi run của A chạy ⇒ run cancelled, 0 tin agent", async () => {
    const room = await groupB("Nhóm xoá");
    const { s, job } = await running(room);
    expect((await api(c.hub, await c.tok("hoa"), "DELETE", `/rooms/${room}`)).status).toBe(204);
    expect(await settled(s.runId)).toBe("cancelled");
    await lateResult(job);
    expect(await agentRows(s.runId)).toBe(0);
  });

  it("HUB-FR-101 · X2b-R17 · đối chứng: E (không phải người gọi) rời ⇒ run A chạy nốt, tin agent đăng, E không còn thấy phòng", async () => {
    const room = await groupB("Nhóm E rời");
    const { s, job } = await running(room);
    expect((await api(c.hub, await c.tok("tam"), "POST", `/rooms/${room}/leave`)).status).toBe(204);
    expect(await runStatus(s.runId)).toBe("running");
    await c.rt.agent(job, { status: "done", text: "HD-12 hợp lệ." });
    const m = await waitAgentMsg(c, "hoa", room, s.runId);
    expect({ run_status: m?.run_status, rows: await agentRows(s.runId) }).toEqual({
      run_status: "finished",
      rows: 1,
    });
  });
});

describe("X2b-AC14 · Q2 · D15 · thu hồi quyền agent giữa chừng", () => {
  const revoke = async () => {
    await c.sql`delete from hub.agent_grants where agent_id = ${AGB.hoadon} and subject_id = ${P.lan.id}`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  };
  const restore = async () => {
    await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${AGB.hoadon}, ${P.lan.tid}, 'user', ${P.lan.id}) on conflict do nothing`;
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  };

  it("HUB-BR-21 · X2b-AC14 · thu hồi hoadon của A khi run đang chạy ⇒ run chạy nốt, tin agent finished", async () => {
    const room = await groupB("Nhóm thu hồi chạy");
    const { s, job } = await running(room);
    await revoke();
    try {
      await c.rt.agent(job, { status: "done", text: "HD-12 hợp lệ." });
      const m = await waitAgentMsg(c, "hoa", room, s.runId);
      expect({ status: await runStatus(s.runId), run_status: m?.run_status }).toEqual({
        status: "finished",
        run_status: "finished",
      });
    } finally {
      await restore();
    }
  });

  it("HUB-BR-21 · X2b-D15 · side_effect chờ xác nhận, thu hồi hoadon, A xác nhận ⇒ 201 + run mới cancelled, xác nhận declined, tin agent 'cancelled'", async () => {
    const room = await groupB("Nhóm thu hồi xác nhận");
    const s = await invoke(c, "lan", room, "@hoadon tạo thẻ thanh toán");
    const job = await c.rt.next(s.runId);
    const [run] = await c.sql<
      { flow_id: string }[]
    >`select flow_id from hub.runs where id = ${s.runId}`;
    await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${P.lan.tid}, ${P.lan.id}, ${run?.flow_id ?? s.runId}, ${s.runId}, ${AGB.hoadon},
        'a2bb0000-0000-4000-8000-000000008201', 'pending')`;
    await c.rt.agent(job, { status: "done", text: "Xác nhận tạo thẻ trên bảng Kế toán?" });
    const m = await waitAgentMsg(c, "lan", room, s.runId);
    expect(m?.ask?.kind).toBe("side_effect");
    await revoke();
    try {
      const r = await post(c, "lan", room, {
        content: "Đồng ý",
        flow_id: m?.flow_id,
        answer_run_id: s.runId,
      });
      expect(r.res.status).toBe(201);
      const confirmRun = r.runId ?? "<không có X-Run-Id>";
      expect(await settled(confirmRun)).toBe("cancelled");
      const after = await waitAgentMsg(
        c,
        "hoa",
        room,
        confirmRun,
        8_000,
        m?.flow_id as string | undefined,
      );
      const [tc] = await c.sql<
        { status: string }[]
      >`select status from hub.tool_confirmations where run_id = ${s.runId}`;
      expect({ run_status: after?.run_status, confirmation: tc?.status }).toEqual({
        run_status: "cancelled",
        confirmation: "declined",
      });
    } finally {
      await restore();
    }
  });

  it("HUB-BR-21 · X2b-D15 · đối chứng: còn quyền, A xác nhận ⇒ run mới không bị huỷ ngay (job xếp hàng cho Runtime)", async () => {
    const room = await groupB("Nhóm còn quyền");
    const s = await invoke(c, "lan", room, "@hoadon tạo thẻ");
    const job = await c.rt.next(s.runId);
    const [run] = await c.sql<
      { flow_id: string }[]
    >`select flow_id from hub.runs where id = ${s.runId}`;
    await c.sql`insert into hub.tool_confirmations (tenant_id, user_id, flow_id, run_id, agent_id, workflow_id, status)
      values (${P.lan.tid}, ${P.lan.id}, ${run?.flow_id ?? s.runId}, ${s.runId}, ${AGB.hoadon},
        'a2bb0000-0000-4000-8000-000000008202', 'pending')`;
    await c.rt.agent(job, { status: "done", text: "Xác nhận tạo thẻ?" });
    const m = await waitAgentMsg(c, "lan", room, s.runId);
    const r = await post(c, "lan", room, {
      content: "Đồng ý",
      flow_id: m?.flow_id,
      answer_run_id: s.runId,
    });
    expect(r.res.status).toBe(201);
    const next = await answer(c, r.runId ?? "<không có X-Run-Id>", "Đã tạo thẻ.");
    expect(next.runId).toBe(r.runId ?? "");
  });
});
