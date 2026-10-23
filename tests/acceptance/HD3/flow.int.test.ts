// HD-FR-31…35 · HD-FR-37 · M3-decouple: flow duyệt HĐ là máy trạng thái của gói — `/extract` mở lượt duyệt (`contracts.approvals`)
// ⇒ job AI đọc gọi model TRỰC TIẾP (không tool, lời nhắc có rào) ⇒ `needs_review` + cấp 1 (Group editor) ⇒ Xác nhận ⇒ rẽ theo ngưỡng
// tenant ⇒ cấp 2 (Group owner, người bắt đầu bị chặn) ⇒ "Đã duyệt" / "Bị từ chối". Chờ bằng tín hiệu; model giả (không AI thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { PA } from "../P-d/_support/pd";
import {
  act,
  agentJson,
  approval,
  approvalRow,
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

describe("HD-FR-31/32 · mở lượt duyệt + AI đọc bằng lời gọi model trực tiếp", () => {
  it("AC31a · AC32a · /extract ⇒ lượt duyệt gắn `run_id`, model gọi KHÔNG tool/MCP, lời nhắc có rào; đọc xong ⇒ needs_review, bước level1; usage ghi theo tenant", async () => {
    const id = await seedContract(c, 1);
    const { runId, call } = await toLevel1(c, id, 245_000_000);
    // Yêu cầu model chỉ có model/system/prompt/maxTokens — không có trường tool hay MCP nào.
    expect(Object.keys(call).sort()).toEqual(["maxTokens", "model", "prompt", "system"]);
    expect(call.prompt).toContain("HỢP ĐỒNG MUA BÁN số 01/2026/HĐMB-PN");
    const row = await contractRow(c, id);
    expect({ status: row.status, run: row.run_id }).toEqual({ status: "needs_review", run: runId });
    expect(await approvalRow(c, runId)).toMatchObject({
      tenant_id: T.acme,
      started_by: PA.A.id,
      status: "level1",
    });
    const a = await approval(c, "B", id);
    expect(a.json).toMatchObject({ run_id: runId, step: "level1", can_act: true });
    // Người dùng 2026-10-23: H chỉ thuộc owner (cấp 2) cũng xác nhận được cấp 1 (Toàn quyền làm được cả bước 1).
    expect((await approval(c, "H", id)).json?.can_act).toBe(true);
    const [u] = await c.sql<{ n: number; feature: string }[]>`select count(*)::int as n,
        min(feature) as feature from hub.usage_logs
      where tenant_id = ${T.acme} and user_id = ${PA.A.id} and feature = 'contracts.extract'`;
    expect(u?.n).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("HD-FR-31 · lượt duyệt sống ⇒ /extract lần 2 ⇒ 409 EXTRACT_BUSY, không lượt mới", async () => {
    const id = await seedContract(c, 2);
    const { runId } = await toLevel1(c, id, 1_000);
    const r = await c.call("A", "POST", `${CBASE}/${id}/extract`);
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 409, code: "EXTRACT_BUSY" });
    expect((await contractRow(c, id)).run_id).toBe(runId);
  }, 60_000);
});

describe("HD-FR-33 · rẽ nhánh theo ngưỡng tenant + Đã duyệt", () => {
  it("AC33a · 245 tr < 500 tr (mặc định) ⇒ B Xác nhận ⇒ không cấp 2, HĐ active (Đã duyệt), lượt done", async () => {
    const id = await seedContract(c, 3);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const r = await act(c, "B", id, "approve");
    expect({ status: r.status, code: errCode(r), step: r.json?.step }).toEqual({
      status: 200,
      code: null,
      step: "done",
    });
    const row = await contractRow(c, id);
    expect({ status: row.status, by: row.confirmed_by, at: row.confirmed_at !== null }).toEqual({
      status: "active",
      by: PA.B.id,
      at: true,
    });
    // Một bước duyệt duy nhất: người xác nhận cấp 1 cũng là người quyết cuối (không qua cấp 2).
    expect(await approvalRow(c, runId)).toMatchObject({
      status: "done",
      level1_by: PA.B.id,
      decided_by: PA.B.id,
    });
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
    expect(await contractRow(c, id)).toMatchObject({ status: "active", confirmed_by: PA.H.id });
    expect(await approvalRow(c, runId)).toMatchObject({
      status: "done",
      level1_by: PA.A.id,
      decided_by: PA.H.id,
    });
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
  it("AC34b · Từ chối không lý do ⇒ 422 FEEDBACK_REQUIRED; có lý do ⇒ HĐ rejected (Bị từ chối) + lượt rejected", async () => {
    const id = await seedContract(c, 8);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const bad = await act(c, "B", id, "reject");
    expect({ status: bad.status, code: errCode(bad) }).toEqual({
      status: 422,
      code: "FEEDBACK_REQUIRED",
    });
    const ok = await act(c, "B", id, "reject", "Sai đối tác");
    expect({ status: ok.status, step: ok.json?.step }).toEqual({ status: 200, step: "rejected" });
    expect(await approvalRow(c, runId)).toMatchObject({
      status: "rejected",
      decided_by: PA.B.id,
      feedback: "Sai đối tác",
    });
    expect((await contractRow(c, id)).status).toBe("rejected");
    const [ev] = await c.sql<
      { data: { feedback: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${id} and type = 'rejected'`;
    expect(ev?.data.feedback).toBe("Sai đối tác");
  }, 60_000);

  it("AC34b · cấp 2 · owner khác người bắt đầu Từ chối (có lý do) ⇒ rejected; sau đó không còn bước mở ⇒ 409", async () => {
    const id = await seedContract(c, 9);
    const { runId } = await toLevel1(c, id, 600_000_000);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    const ok = await act(c, "H", id, "reject", "Vượt ngân sách");
    expect({ status: ok.status, step: ok.json?.step }).toEqual({ status: 200, step: "rejected" });
    expect(await approvalRow(c, runId)).toMatchObject({ status: "rejected", decided_by: PA.H.id });
    expect((await contractRow(c, id)).status).toBe("rejected");
    const again = await act(c, "H", id, "approve");
    expect({ status: again.status, code: errCode(again) }).toEqual({
      status: 409,
      code: "APPROVAL_NOT_OPEN",
    });
  }, 60_000);

  it("redo (Trích lại ở cấp 1) ⇒ lượt AI mới, kết quả mới ghi đè, vẫn cấp 1", async () => {
    const id = await seedContract(c, 10);
    await toLevel1(c, id, 245_000_000);
    c.model.reply = { ok: true, text: agentJson({ total_value: { value: 9, quote: "9" } }) };
    const done = c.extracted(id);
    const r = await act(c, "B", id, "redo", "Đọc lại");
    expect(r.status).toBe(200);
    expect(await done).toBe("needs_review");
    const d = (await c.call("B", "GET", `${CBASE}/${id}`)).json;
    expect({ status: d.status, v: d.fields.total_value.value }).toEqual({
      status: "needs_review",
      v: 9,
    });
    expect((await approval(c, "B", id)).json?.step).toBe("level1");
  }, 60_000);
});
