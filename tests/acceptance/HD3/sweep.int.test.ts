// HD-FR-35 · AC35a · #218 · #221 · D3-06 · D3-09 · D3-10: vòng quét flow duyệt + trần thao tác theo tenant. (1) Từ chối qua engine
// (chat-web) ⇒ lượt quét kế ghi "Bị từ chối" (không cần mở S05); (2) `extracting` không run quá 15 phút ⇒ `extract_failed STALE`;
// lượt 2 không đổi gì (idempotent); (3) vượt trần thao tác ⇒ 429 `ACTION_QUOTA {limit, resets_at}`, không run mới.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract } from "../HD1/_support/hd1";
import { PA } from "../P-d/_support/pd";
import {
  C1_TEXT,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
  errCode,
  seedContract,
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

describe("D3-09 · vòng quét [HD-FR-35]", () => {
  it("D3-06 · Từ chối ở chat-web ⇒ quét ⇒ rejected + event; lượt 2 closed = 0", async () => {
    const id = await seedContract(c, 70);
    const { runId } = await toLevel1(c, id, 245_000_000);
    const [t] = await c.sql<
      { id: string }[]
    >`select id from hub.review_tasks where process_run_id = ${runId}
      and kind = 'review' and status = 'open'`;
    const r = await c.call("B", "POST", `/review-tasks/${t?.id}/decision`, {
      result: "reject",
      feedback: "Sai MST",
    });
    expect(r.status).toBe(200);
    const s1 = await c.sweepOnce();
    expect(s1.closed).toBeGreaterThanOrEqual(1);
    expect((await contractRow(c, id)).status).toBe("rejected");
    const [ev] = await c.sql<
      { data: { feedback: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${id} and type = 'rejected'`;
    expect(ev?.data.feedback).toBe("Sai MST");
    expect((await c.sweepOnce()).closed).toBe(0);
  }, 60_000);

  it("#218 · `extracting` không run > 15 phút ⇒ extract_failed STALE; mới tải lên (< 15 phút) giữ nguyên", async () => {
    await insContract(c.sql, {
      id: cid(71),
      tenant: T.acme,
      status: "extracting",
      source: C1_TEXT,
      createdBy: PA.A.id,
      updatedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
    } as never);
    await insContract(c.sql, {
      id: cid(72),
      tenant: T.acme,
      status: "extracting",
      source: C1_TEXT,
      createdBy: PA.A.id,
      updatedAt: new Date().toISOString(),
    } as never);
    await c.sweepOnce();
    expect(await contractRow(c, cid(71))).toMatchObject({
      status: "extract_failed",
      error: "STALE",
    });
    expect((await contractRow(c, cid(72))).status).toBe("extracting");
  }, 60_000);
});

describe("D3-10 · trần thao tác theo tenant [HD-FR-35, #221]", () => {
  it("AC35a · bộ đếm ngày đầy ⇒ /extract 429 ACTION_QUOTA {limit, resets_at}, run_id vẫn null", async () => {
    const id = await seedContract(c, 73);
    const keys = await c.hub.redis.keys(`q:contracts:a:${T.acme}:*`);
    const day = keys[0] ?? `q:contracts:a:${T.acme}:x`;
    // Đếm đã chạy ở ca trước (≥ 1 khoá); đặt tới trần mặc định 100.
    expect({ counter: keys.length > 0 }).toEqual({ counter: true });
    await c.hub.redis.set(day, "100");
    const r = await c.call("A", "POST", `${CBASE}/${id}/extract`);
    expect({ status: r.status, code: errCode(r) }).toEqual({ status: 429, code: "ACTION_QUOTA" });
    expect(r.json?.error?.details).toMatchObject({ limit: 100 });
    expect(typeof r.json?.error?.details?.resets_at).toBe("string");
    expect((await contractRow(c, id)).run_id).toBeNull();
    await c.hub.redis.del(day);
  }, 60_000);
});
