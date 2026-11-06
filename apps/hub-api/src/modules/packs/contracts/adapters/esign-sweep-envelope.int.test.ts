// CR-122 · E5b · `esign-sweep` đọc hạn ký + chu kỳ nhắc từ PHONG BÌ (node Ký số đặt) TRƯỚC; cột trống ⇒ bước Ký số cũ (`flow_steps`).
// DB thật (pool hub_api, role gói): hai HĐ cùng bước Ký số cũ (hạn 72h, nhắc 24h) gửi cách đây 2h — phong bì có due_h=1/remind=1 ⇒ nhắc +
// quá hạn (chuyển cấp); phong bì để trống ⇒ chưa tới hạn. Một lượt quét, câu SQL không đổi số lượng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { esignSweepRepo } from "./esign-sweep.repo";

let o: Sql;
let db: Db;
let T = "";
let K: string[] = [];
const NOW = new Date(Date.now() + 3_600_000 * 4); // sau mọi mốc `now()` của hàng seed
const ago = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const STEP = [
  {
    kind: "esign",
    key: "sign",
    name: "Ký số",
    company_signer: { mode: "owner" },
    partner_signs: false,
    order: "company_first",
    provider: null,
    due_h: 72,
    remind_every_h: 24,
    escalate_group_id: null,
  },
];

/** Bước Ký số cũ đã gửi 2h trước + phong bì mở với hạn/nhắc (null ⇒ cột trống). */
async function seed(cid: string, env: string, due: number | null, rem: number | null) {
  const owner = (
    await o<
      { o: string }[]
    >`select owner_user_id::text as o from contracts.contracts where id = ${cid}`
  )[0]?.o as string;
  const aid = crypto.randomUUID();
  await o`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by, mode, flow_steps,
      esign_status, esign_at, esign_signer)
    values (${aid}, ${T}, ${cid}, 'done', ${owner}, 'engine', ${o.json(STEP as never)}, 'sent', ${ago(2)}, ${owner})`;
  await o`update contracts.contracts set run_id = ${aid} where id = ${cid}`;
  await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by, due_h, remind_every_h)
    values (${T}, ${cid}, 'selfsign', ${env},
      ${o.json([{ role: "company", name: "A", email: "a@x.vn", order: 1, client_user_id: owner }] as never)},
      ${owner}, ${due}, ${rem})`;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T] = (await tenants(o, 1, 981)) as [string];
  const [U] = (await users(o, T, 1, { from: 981 })) as [string];
  K = await contracts(o, T, 2, { from: 981, createdBy: U, owner: U });
  await seed(K[0] as string, "e5b-node", 1, 1); // node đặt hạn 1h, nhắc mỗi 1h
  await seed(K[1] as string, "e5b-old", null, null); // phong bì cũ ⇒ bước Ký số cũ (72h/24h)
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("E5b · esign-sweep đọc hạn/nhắc từ phong bì trước", () => {
  it("phong bì có hạn/nhắc ⇒ nhắc + quá hạn; phong bì trống ⇒ theo bước Ký số cũ (chưa tới hạn)", async () => {
    const uow = createPackUow(db, "contracts", (tx, t) => ({ esignSweep: esignSweepRepo(tx, t) }));
    const rows = await uow.system(T, (r) =>
      r.esignSweep.sweep({ now: NOW, staleMin: 15, limit: 50 }),
    );
    expect(rows.map((r) => r.contractId)).toEqual([K[0] as string]);
    expect(rows[0]).toMatchObject({ remind: true, overdue: true });
    // Lần quét lại cùng thời điểm: đã đặt mốc nhắc/chuyển cấp ⇒ không lặp.
    const again = await uow.system(T, (r) =>
      r.esignSweep.sweep({ now: NOW, staleMin: 15, limit: 50 }),
    );
    expect(again).toEqual([]);
  });
});
