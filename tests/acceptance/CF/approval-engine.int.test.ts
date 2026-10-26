// contract-flow S3a · duyệt HĐ trên engine (cờ bật, hub THẬT): AI đọc xong ⇒ lượt `level1` mở run engine `contracts-approval`
// (ref contracts/HĐ, `mode='engine'`, `flow_version` 1 = mẫu mặc định, `flow_steps` chụp 2 bước); máy cũ không quyết lượt engine;
// Đạt bước 0 (giá trị dưới ngưỡng) ⇒ `contracts-route` rẽ thẳng `finalize` ⇒ `contracts-finalize` ghi Đã duyệt + khoá + gắn SP chờ
// (`pending_links`) CÙNG tx, `confirmed_by` = người Đạt. Chéo tenant: tool gọi với tenant khác / run khác không chạm HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { urls } from "@ai/test-kit/env";
import { approvalEngineRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-engine.repo";
import { approvalEngineTools } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-engine.tools";
import { approvalFlowRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-flow.repo";
import { productLinksRepo } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/product-links.repo";
import { createPackUow } from "../../../apps/hub-api/src/modules/packs/kit/adapters/pack-uow";
import { insItem } from "../HD1/_support/hd1";
import { act, CBASE, errCode, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
let db: Db;
beforeAll(async () => {
  c = await startCf();
  db = createDb(urls().hubApi, { max: 2 });
}, 180_000);
afterAll(async () => {
  await db?.close();
  await c?.stop();
});

const approvalOf = async (aid: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, mode, engine_run_id::text as run, flow_version,
      jsonb_array_length(flow_steps) as n, decided_by::text as by from contracts.approvals where id = ${aid}`
  )[0] as Json;
const contractOf = async (id: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, confirmed_by::text as by, locked_at is not null as locked
      from contracts.contracts where id = ${id}`
  )[0] as Json;

/** Tool engine dựng trực tiếp trên pool hub_api (RLS gói) — gọi như stage tool với danh tính tuỳ ý. */
const tools = () => {
  const uow = createPackUow(db, "contracts", (tx, tid) => ({
    approvalEngine: approvalEngineRepo(tx, tid),
    approvalFlow: approvalFlowRepo(tx, tid),
    links: productLinksRepo(tx, tid),
  }));
  const t = approvalEngineTools({ uow, bridge: { port: c.port } });
  return { route: t[0]?.run, finalize: t[1]?.run } as const;
};

describe("contract-flow S3a · duyệt trên engine", () => {
  let id = "";
  let aid = "";
  let run = "";

  it("mở cấp 1 ⇒ run engine gắn HĐ (mode engine, flow v1, 2 bước, ref contracts)", async () => {
    id = await seedContract(c, 701);
    aid = (await toLevel1(c, id, 10_000_000)).runId;
    const a = await approvalOf(aid);
    expect({ s: a.status, m: a.mode, v: a.flow_version, n: a.n }).toEqual({
      s: "level1",
      m: "engine",
      v: 1,
      n: 2,
    });
    run = a.run as string;
    const [r] = await c.sql<
      Json[]
    >`select pack_key, pack_record_id::text as rec, tenant_id::text as t
      from hub.process_runs where id = ${run}`;
    expect(r).toEqual({ pack_key: "contracts", rec: id, t: T.acme });
    await waitStatus(c.sql, run, "waiting_review");
    // Máy 2 bước cũ không quyết lượt chạy trên engine.
    // S3b: lượt engine quyết qua engine (không còn chặn). Kiểm không đổi trạng thái: Trả lại ở bước soạn ⇒ APPROVAL_NOT_OPEN.
    const m = await act(c, "B", id, "return", "x");
    expect(errCode(m)).toBe("APPROVAL_NOT_OPEN");
  }, 60_000);

  it("chéo tenant / run khác: tool không chạm HĐ", async () => {
    const t = tools();
    const beta = { tenantId: T.beta, userId: PA.Db.id, processRunId: run, runId: null };
    await expect(
      t.route?.(beta, { contract_id: id, from_step: 0 }) as Promise<unknown>,
    ).rejects.toThrow();
    await expect(t.finalize?.(beta, { contract_id: id }) as Promise<unknown>).rejects.toThrow();
    const other = {
      tenantId: T.acme,
      userId: PA.A.id,
      processRunId: crypto.randomUUID(),
      runId: null,
    };
    await expect(t.finalize?.(other, { contract_id: id }) as Promise<unknown>).rejects.toThrow();
    // Chưa ai Đạt ⇒ finalize đúng run cũng từ chối.
    const own = { tenantId: T.acme, userId: PA.A.id, processRunId: run, runId: null };
    await expect(t.finalize?.(own, { contract_id: id }) as Promise<unknown>).rejects.toThrow();
    expect(await contractOf(id)).toEqual({ status: "needs_review", by: null, locked: false });
  }, 30_000);

  it("Đạt bước 0 (dưới ngưỡng) ⇒ finalize: Đã duyệt + khoá + gắn SP chờ cùng tx, confirmed_by = người Đạt", async () => {
    const item = "e3000000-0000-4000-8000-000000000701";
    await insItem(c.sql, T.acme, id, 90, { id: item, name: "Thùng CF-701" } as never);
    const links = [
      { item_id: item, new_product: { name: "Thùng CF-701", unit: "thùng", group: "goods" } },
    ];
    await c.sql`update contracts.approvals set pending_links = ${c.sql.json(links as never)} where id = ${aid}`;
    expect(await c.port.act(caller(PA.B), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
    await waitStatus(c.sql, run, "done");
    expect(await contractOf(id)).toEqual({ status: "active", by: PA.B.id, locked: true });
    expect(await approvalOf(aid)).toMatchObject({ status: "done", by: PA.B.id });
    const [it0] = await c.sql<
      Json[]
    >`select product_id is not null as linked from contracts.contract_items
      where id = ${item}`;
    expect(it0?.linked).toBe(true);
    const g = await c.call("A", "GET", `${CBASE}/${id}/approval`);
    expect(g.status).toBe(200);
  }, 60_000);
});
