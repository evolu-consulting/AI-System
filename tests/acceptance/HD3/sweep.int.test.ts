// HD-FR-35 · AC35a · #218 · #221 · D3-09 · D3-10 · M3-decouple: vòng quét flow duyệt + trần thao tác theo tenant. (1) Lượt AI đọc
// mất job (khởi động lại giữa chừng) ⇒ HĐ `extracting` + lượt `extracting` quá 15 phút ⇒ `extract_failed STALE`, lượt `failed`;
// lượt quét 2 không đổi gì (idempotent); (2) `extracting` không lượt quá 15 phút ⇒ STALE, mới tải lên giữ nguyên; (3) vượt trần
// thao tác ⇒ 429 `ACTION_QUOTA {limit, resets_at}`, không lượt mới.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insContract } from "../HD1/_support/hd1";
import { PA } from "../P-d/_support/pd";
import {
  agentJson,
  approvalRow,
  C1_TEXT,
  CBASE,
  type CtxHd3,
  cid,
  contractRow,
  errCode,
  seedContract,
  startHd3,
  T,
  total,
} from "./_hd3";

let c: CtxHd3;
beforeAll(async () => {
  c = await startHd3();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

describe("D3-09 · vòng quét [HD-FR-35]", () => {
  it("#218 · lượt AI mất (HĐ + lượt kẹt `extracting` > 15 phút) ⇒ quét ⇒ extract_failed STALE + event, lượt failed; lượt 2 closed = 0", async () => {
    const id = await seedContract(c, 70);
    c.model.reply = { ok: true, text: agentJson(total(245_000_000)) };
    const done = c.extracted(id);
    expect((await c.call("A", "POST", `${CBASE}/${id}/extract`)).status).toBe(202);
    await done;
    const runId = (await contractRow(c, id)).run_id as string;
    // Giả lập job mất giữa chừng: HĐ + lượt về `extracting`, cũ 20 phút.
    await c.sql`update contracts.contracts set status = 'extracting',
      updated_at = now() - interval '20 minutes' where id = ${id}`;
    await c.sql`update contracts.approvals set status = 'extracting' where id = ${runId}`;
    const s1 = await c.sweepOnce();
    expect(s1.closed).toBeGreaterThanOrEqual(1);
    expect(await contractRow(c, id)).toMatchObject({ status: "extract_failed", error: "STALE" });
    expect((await approvalRow(c, runId)).status).toBe("failed");
    const [ev] = await c.sql<
      { data: { code: string } }[]
    >`select data from contracts.contract_events
      where contract_id = ${id} and type = 'extract_failed' order by id desc limit 1`;
    expect(ev?.data.code).toBe("STALE");
    expect((await c.sweepOnce()).closed).toBe(0);
  }, 60_000);

  it("#218 · `extracting` không lượt > 15 phút ⇒ extract_failed STALE; mới tải lên (< 15 phút) giữ nguyên", async () => {
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
