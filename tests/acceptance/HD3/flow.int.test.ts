// HD-FR-31…35 · HD-FR-37 · flow duyệt HĐ trên engine N2: `/extract` mở run `contracts-approval` (def gói tự dựng) ⇒ stage `extract`
// chạy tool gói ⇒ job agent KHÔNG tool (#219) ⇒ `needs_review` + task cấp 1 ⇒ Xác nhận ⇒ rẽ theo ngưỡng tenant ⇒ cấp 2 (người
// bắt đầu bị chặn) ⇒ "Đã duyệt" / "Bị từ chối". Chờ bằng `handles.settled()`; runtime giả trả lời job (không AI thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { nextStageJob, PA, waitStatus } from "../P-d/_support/pd";
import {
  act,
  approval,
  CBASE,
  type CtxHd3,
  contractRow,
  errCode,
  seedContract,
  settled,
  startHd3,
  T,
  toLevel1,
} from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("HD-FR-31/32 · mở run + trích qua agent không tool", () => {
  it("AC31a · AC32a · /extract ⇒ run gắn `run_id`, job agent allowed_tools=[] mcp=null, prompt có rào; trích xong ⇒ needs_review, bước level1", async () => {
    const id = await seedContract(c, 1);
    const { runId, job } = await toLevel1(c, id, 245_000_000);
    const p = (job as { payload: Record<string, unknown> }).payload;
    expect({ tools: p.allowed_tools, mcp: p.mcp ?? null }).toEqual({ tools: [], mcp: null });
    expect(String(p.prompt)).toContain("HỢP ĐỒNG MUA BÁN số 01/2026/HĐMB-PN");
    const row = await contractRow(c, id);
    expect({ status: row.status, run: row.run_id }).toEqual({ status: "needs_review", run: runId });
    const [run] = await c.sql<
      { tenant_id: string; started_by: string }[]
    >`select tenant_id, started_by
      from hub.process_runs where id = ${runId}`;
    expect(run).toEqual({ tenant_id: T.acme, started_by: PA.A.id });
    const a = await approval(c, "B", id);
    expect(a.json).toMatchObject({ run_id: runId, step: "level1", can_act: true });
    expect((await approval(c, "H", id)).json?.can_act).toBe(false); // H chỉ thuộc owner (cấp 2)
  }, 60_000);

  it("HD-FR-31 · run sống ⇒ /extract lần 2 ⇒ 409 EXTRACT_BUSY, không run mới", async () => {
    const id = await seedContract(c, 2);
    await toLevel1(c, id, 1_000);
    const r = await c.call("A", "POST", `${CBASE}/${id}/extract`);
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 409, code: "EXTRACT_BUSY" });
  }, 60_000);
});

describe("HD-FR-33 · rẽ nhánh theo ngưỡng tenant + Đã duyệt", () => {
  it("AC33a · 245 tr < 500 tr (mặc định) ⇒ B Xác nhận ⇒ không cấp 2, HĐ active (Đã duyệt), run done", async () => {
    const id = await seedContract(c, 3);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const r = await act(c, "B", id, "approve");
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 200, code: null });
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    const row = await contractRow(c, id);
    expect({ status: row.status, by: row.confirmed_by, at: row.confirmed_at !== null }).toEqual({
      status: "active",
      by: PA.B.id,
      at: true,
    });
    const reviews = await c.sql`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review'`;
    expect(reviews).toHaveLength(1);
  }, 60_000);

  it("AC33b · AC34d · 600 tr ⇒ cấp 2; A (người bắt đầu, thuộc owner) Duyệt/Từ chối ⇒ 403 STARTER_CANNOT_REVIEW; H Duyệt ⇒ active", async () => {
    const id = await seedContract(c, 4);
    const { runId } = await toLevel1(c, id, 600_000_000);
    expect((await act(c, "A", id, "approve")).status).toBe(200); // cấp 1: người tải lên được (câu 5)
    await settled(c);
    const a = await approval(c, "A", id);
    expect(a.json).toMatchObject({ step: "level2", can_act: false });
    for (const [action, fb] of [
      ["approve", undefined],
      ["reject", "Không đồng ý"],
    ] as const) {
      const no = await act(c, "A", id, action, fb);
      expect({ action, status: no.status, code: errCode(no) }).toEqual({
        action,
        status: 403,
        code: "STARTER_CANNOT_REVIEW",
      });
    }
    expect((await act(c, "H", id, "approve")).status).toBe(200);
    await settled(c);
    await waitStatus(c.sql, runId, "done");
    expect(await contractRow(c, id)).toMatchObject({ status: "active", confirmed_by: PA.H.id });
  }, 60_000);

  it("AC33c · đúng 500.000.000 ⇒ cấp 2 (≥)", async () => {
    const id = await seedContract(c, 5);
    await toLevel1(c, id, 500_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await approval(c, "H", id)).json).toMatchObject({ step: "level2", can_act: true });
  }, 60_000);

  it("AC33d · D3-02 · sửa tay total_value lên 700 tr ở cấp 1 ⇒ rẽ theo giá trị HIỆN TẠI ⇒ cấp 2", async () => {
    const id = await seedContract(c, 6);
    await toLevel1(c, id, 245_000_000);
    const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
    const p = await c.call("B", "PATCH", `${CBASE}/${id}/fields`, {
      version: d.version,
      fields: { total_value: 700_000_000 },
    });
    expect(p.status).toBe(200);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await settled(c);
    expect((await approval(c, "H", id)).json?.step).toBe("level2");
  }, 60_000);

  it("AC37a · ngưỡng tenant 100 tr (cài đặt) ⇒ 245 tr cần cấp 2; PUT cài đặt cần quyền admin gói", async () => {
    const no = await c.call("B", "PUT", `/pack/contracts/approval-settings`, {
      threshold: 100_000_000,
    });
    expect(no.status).toBe(403);
    const s = await c.call("A", "PUT", `/pack/contracts/approval-settings`, {
      threshold: 100_000_000,
    });
    expect({ status: s.status, t: s.json?.threshold }).toEqual({ status: 200, t: 100_000_000 });
    try {
      const id = await seedContract(c, 7);
      await toLevel1(c, id, 245_000_000);
      expect((await act(c, "B", id, "approve")).status).toBe(200);
      await settled(c);
      expect((await approval(c, "H", id)).json?.step).toBe("level2");
    } finally {
      await c.call("A", "PUT", `/pack/contracts/approval-settings`, { threshold: 500_000_000 });
    }
  }, 60_000);
});

describe("HD-FR-34 · Từ chối", () => {
  it("AC34b · Từ chối không lý do ⇒ 422 FEEDBACK_REQUIRED; có lý do ⇒ HĐ rejected (Bị từ chối) + run cancelled", async () => {
    const id = await seedContract(c, 8);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const bad = await act(c, "B", id, "reject");
    expect({ status: bad.status, code: errCode(bad) }).toEqual({
      status: 422,
      code: "FEEDBACK_REQUIRED",
    });
    const ok = await act(c, "B", id, "reject", "Sai đối tác");
    expect({ status: ok.status, step: ok.json?.step }).toEqual({ status: 200, step: "rejected" });
    await waitStatus(c.sql, runId, "cancelled");
    expect((await contractRow(c, id)).status).toBe("rejected");
    const [ev] = await c.sql<
      { data: { feedback: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${id} and type = 'rejected'`;
    expect(ev?.data.feedback).toBe("Sai đối tác");
  }, 60_000);

  it("D3-06 · Từ chối qua engine (chat-web) ⇒ GET approval hoà giải ⇒ HĐ rejected", async () => {
    const id = await seedContract(c, 9);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const [t] = await c.sql<
      { id: string }[]
    >`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open'`;
    const r = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, {
      result: "reject",
      feedback: "Từ chat",
    });
    expect(r.status).toBe(200);
    expect((await approval(c, "B", id)).json?.step).toBe("rejected");
    expect((await contractRow(c, id)).status).toBe("rejected");
  }, 60_000);

  it("redo (Trích lại ở cấp 1) ⇒ job agent mới, kết quả mới ghi đè, vẫn cấp 1", async () => {
    const id = await seedContract(c, 10);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const r = await act(c, "B", id, "redo", "Đọc lại");
    expect(r.status).toBe(200);
    const job = await nextStageJob(c, runId);
    const { agentJson } = await import("./_hd3");
    const { jobDone } = await import("../P-d/_support/pd");
    await jobDone(c, job, agentJson({ total_value: { value: 9, quote: "9" } }));
    await settled(c);
    const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
    expect({ status: d.status, v: d.fields.total_value.value }).toEqual({
      status: "needs_review",
      v: 9,
    });
  }, 60_000);
});
