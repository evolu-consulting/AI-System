// CR-107 · độ tin cậy flow duyệt trên engine (gói contracts, hub THẬT, cờ engine bật):
// (1) lỗi logic của tool `contracts-route` là lỗi NGHIỆP VỤ ⇒ run `needs_decision` (`tool_failed`) NGAY, không hẹn thử lại; thẻ duyệt
//     hiện `attention`; chỉ owner/admin "Thử lại" (`add_attempt` của engine) ⇒ run chạy tiếp tới "Đã duyệt".
// (2) "Huỷ & mở lại" ⇒ run cũ huỷ, lượt giữ engine, run mới dưới người gửi, bước 0 mở lại.
// (3) run mồ côi (mở rồi chưa gắn lượt) quá 10' ⇒ vòng quét huỷ; run đang gắn lượt giữ nguyên.
// Chờ engine chạy nền bằng `waitFor` (khuôn CF hiện có — tool stage chạy sau kick, không có tín hiệu xong cho gói).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { approval, CBASE, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitFor } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const SMALL = 1000; // dưới ngưỡng ⇒ chỉ bước 0 rồi finalize
const row = async (aid: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, mode, engine_run_id::text as run, feedback
      from contracts.approvals where id = ${aid}`
  )[0] as Json;
const runOf = async (run: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, decision, started_by::text as by from hub.process_runs
      where id = ${run}`
  )[0] as Json;
const runIs = (run: string, want: string) =>
  waitFor(
    () => runOf(run),
    (r) => r?.status === want,
    15_000,
  );

/** Lượt engine ở bước 0 ⇒ tạm đưa lượt khỏi `level1` (route thấy "contract not in run") ⇒ B Đạt ⇒ tool route lỗi nghiệp vụ ⇒
 *  needs_decision ⇒ trả lượt về `level1` (dữ liệu đã đúng lại — Thử lại sẽ qua). */
async function toNeedsDecision(n: number) {
  const id = await seedContract(c, n);
  const aid = (await toLevel1(c, id, SMALL)).runId;
  await waitFor(
    async () => ((await approval(c, "A", id)).json as Json)?.steps?.[0]?.status,
    (s) => s === "open",
    10_000,
  );
  const run = (await row(aid)).run as string;
  await c.sql`update contracts.approvals set status = 'level2' where id = ${aid}`;
  expect(await c.port.act(caller(PA.B), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
  const r = await runIs(run, "needs_decision");
  await c.sql`update contracts.approvals set status = 'level1' where id = ${aid}`;
  return { id, aid, run, decision: r?.decision as Json };
}

describe("CR-107 · needs_decision ⇒ owner Thử lại / Huỷ & mở lại", () => {
  it("(1) lỗi logic tool ⇒ needs_decision tool_failed ngay · thẻ có attention · B 403 · A Thử lại ⇒ Đã duyệt", async () => {
    const s = await toNeedsDecision(731);
    expect(s.decision?.reason).toBe("tool_failed"); // nghiệp vụ ⇒ không qua hẹn thử lại (`retry_exhausted` sau ~10,5')
    const card = (await approval(c, "A", s.id)).json as Json;
    expect(card.attention).toMatchObject({ kind: "needs_decision", reason: "tool_failed" });
    expect(card.needs_reopen).toBe(false);
    expect((await row(s.aid)).status).toBe("level1"); // không đổi trạng thái HĐ/lượt
    expect((await c.call("B", "POST", `${CBASE}/${s.id}/approval/retry`, {})).status).toBe(403);
    const r = await c.call("A", "POST", `${CBASE}/${s.id}/approval/retry`, {});
    expect(r.status).toBe(200);
    await runIs(s.run, "done");
    expect((await row(s.aid)).status).toBe("done");
  }, 90_000);

  it("(2) Huỷ & mở lại ⇒ run cũ cancelled, lượt giữ engine + run mới dưới A, bước 0 mở", async () => {
    const s = await toNeedsDecision(732);
    const r = await c.call("A", "POST", `${CBASE}/${s.id}/approval/cancel-reopen`, {});
    expect(r.status).toBe(200);
    expect((await runOf(s.run)).status).toBe("cancelled");
    const a = await row(s.aid);
    expect({ mode: a.mode, status: a.status, feedback: a.feedback }).toEqual({
      mode: "engine",
      status: "level1",
      feedback: null,
    });
    expect(a.run).not.toBe(s.run);
    expect((await runOf(a.run as string)).by).toBe(PA.A.id);
    // Lượt không còn chờ quyết ⇒ Thử lại 409.
    const again = await c.call("A", "POST", `${CBASE}/${s.id}/approval/retry`, {});
    expect(again.status).toBe(409);
  }, 90_000);
});

describe("CR-107 · dọn run mồ côi", () => {
  it("(3) run gói mở chưa gắn lượt, quá 10' ⇒ vòng quét huỷ · run đang gắn lượt giữ", async () => {
    const id = await seedContract(c, 733);
    const aid = (await toLevel1(c, id, SMALL)).runId;
    const attached = (await row(aid)).run as string;
    // Sập giữa `start` và `attach`: run có ref contracts nhưng không lượt nào giữ.
    const { runId: orphan } = await c.port.start(caller(PA.A), {
      process_key: "contracts-approval",
      input: id,
      inputs: [{ type: "text", key: "contract_id", text: id }],
      ref: { pack: "contracts", record_id: id },
    });
    const fresh = (await c.sweepOnce()) as unknown as { orphans: number };
    expect(fresh.orphans).toBe(0);
    expect((await runOf(orphan)).status).not.toBe("cancelled");
    // Đồng hồ: run (và run đang gắn) bắt đầu 11' trước ⇒ quá hạn mồ côi.
    await c.sql`update hub.process_runs set started_at = now() - interval '11 minutes'
      where id in (${orphan}, ${attached}) and tenant_id = ${T.acme}`;
    const out = (await c.sweepOnce()) as unknown as { orphans: number };
    expect(out.orphans).toBeGreaterThanOrEqual(1);
    expect((await runOf(orphan)).status).toBe("cancelled");
    expect((await runOf(attached)).status).not.toBe("cancelled");
  }, 90_000);
});
