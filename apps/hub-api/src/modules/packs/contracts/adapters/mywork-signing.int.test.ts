// CR-125 · x1 · "Chờ bạn ký" của thẻ Tổng quan + thanh dưới (`GET /my-work` → `signing[]`): đọc thật (role `hub_api`, RLS tenant): chỉ phong bì
// CÒN MỞ mà MÌNH là người ký công ty chưa ký và ĐÃ TỚI LƯỢT; người khác / tenant khác không thấy; MỘT câu SQL cố định (≤ 51 hàng) —
// 1.000 phong bì vẫn nhanh (in p50/p95 thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { myWorkRepo } from "./mywork.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let me = "";
let other = "";
let K: string[] = [];

const uow = () =>
  packTenantOnly(createPackUow(db, "contracts", (tx, t) => ({ mywork: myWorkRepo(tx, t) })));
const signing = (tenantId: string, userId: string) =>
  uow().tenant({ tenantId, userId } as never, ({ mywork }) =>
    (mywork.signing as () => Promise<{ contract_id: string }[]>)(),
  );

const signer = (uid: string, order: number, signedAt: string | null) => ({
  role: "company",
  name: "Người ký",
  email: "k@x.vn",
  order,
  client_user_id: uid,
  status: signedAt ? "completed" : null,
  signed_at: signedAt,
});
async function envelope(cid: string, status: string, signers: object[], n = 1, tag = "env-") {
  await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, status, signers, sent_by)
    select ${T}, ${cid}, 'misa', ${tag}::text || ${cid}::text || '-' || g, ${status}, ${o.json(signers as never)}, ${me}
    from generate_series(1, ${n}) g`;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T, T2] = (await tenants(o, 2, 996)) as [string, string];
  [me, other] = (await users(o, T, 2, { from: 996 })) as [string, string];
  K = await contracts(o, T, 6, { from: 996, createdBy: me, owner: me });
  await envelope(K[0] as string, "sent", [signer(me, 1, null)]); // của mình, đến lượt ⇒ đếm
  await envelope(K[1] as string, "sent", [signer(me, 1, "2026-11-01T00:00:00Z")]); // mình đã ký ⇒ không
  await envelope(K[2] as string, "sent", [signer(other, 1, null), signer(me, 2, null)]); // chưa tới lượt ⇒ không
  await envelope(K[3] as string, "completed", [signer(me, 1, null)]); // phong bì đã đóng ⇒ không
  await envelope(
    K[4] as string,
    "delivered",
    [signer(other, 1, null), signer(me, 2, null)].reverse(),
  ); // thứ tự đảo trong mảng vẫn đúng lượt? other trước ⇒ không
  await envelope(K[5] as string, "delivered", [signer(me, 1, null), signer(other, 2, null)]); // đến lượt mình (đã giao) ⇒ đếm
  db = createDb(urls().hubApi, { max: 4 });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 · x1 · signing[] (Chờ bạn ký)", () => {
  it("chỉ phong bì còn mở, mình là người ký chưa ký và đã tới lượt", async () => {
    const rows = await signing(T, me);
    expect(rows.map((r) => r.contract_id).sort()).toEqual([K[0], K[5]].sort() as string[]);
  });
  it("người khác chỉ thấy phần của mình; tenant khác không thấy gì", async () => {
    expect((await signing(T, other)).map((r) => r.contract_id).sort()).toEqual(
      [K[2], K[4]].sort() as string[],
    ); // K4: thứ tự theo trường `order`, không theo vị trí trong mảng
    expect(await signing(T2, me)).toEqual([]);
  });
  it("1.000 phong bì: MỘT câu, ≤ 51 hàng, p95 thấp (đo thật)", async () => {
    await envelope(K[0] as string, "completed", [signer(me, 1, null)], 950, "pc-");
    // 50 phong bì MỞ (mỗi HĐ chỉ một phong bì mở) trên 50 HĐ riêng
    const more = await contracts(o, T, 50, { from: 1200, createdBy: me, owner: me });
    await o`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, status, signers, sent_by)
      select ${T}, c, 'misa', 'ps-' || c::text, 'sent', ${o.json([signer(me, 1, null)] as never)}, ${me}
      from unnest(${more}::uuid[]) c`;
    const ms: number[] = [];
    let last: unknown[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      last = await signing(T, me);
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    const p = (q: number) => ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] as number;
    console.log(
      `x1 perf · signing 1000 phong bì: p50 ${p(0.5).toFixed(1)} ms · p95 ${p(0.95).toFixed(1)} ms`,
    );
    expect(last.length).toBeLessThanOrEqual(51);
    expect(p(0.95)).toBeLessThan(300);
  });
});
