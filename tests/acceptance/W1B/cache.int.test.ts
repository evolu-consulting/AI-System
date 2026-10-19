// W1b · bộ nhớ đệm dòng giá "Mua hàng" an toàn khi chạy NHIỀU instance hub-api: dấu vân tay luôn lấy từ DB mỗi request (số HĐ + updated_at lớn nhất
// + tổng version + băm id/trạng thái/hướng + lựa chọn nguồn), không có bộ đếm cục bộ tiến trình. Hai app hub-api THẬT trên cùng DB, mỗi app một
// bộ nhớ đệm riêng; sửa dữ liệu (qua DB hoặc qua instance này) ⇒ instance kia thấy ngay ở request kế.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp as createHubApp } from "../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, REDIS_TEST_URL } from "../H1/_fixtures";
import { arrangeW1, type CtxN1, d, type Json, P, priced, startHd1, T } from "../W1/_support/w1";

let c: CtxN1;
let base2 = "";
let stop2: () => Promise<void>;
beforeAll(async () => {
  c = await startHd1();
  const db = connectDb(HUB_API_URL, 4);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: c.k.publicKey,
    appEnv: "test",
    instanceId: "w1b-instance-2",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    packs: { contracts: true, filebox: { url: c.fb.origin, token: c.fb.token } },
  } as Parameters<typeof createHubApp>[1];
  const app = createHubApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  base2 = `http://localhost:${server.port}`;
  stop2 = async () => {
    ac.abort();
    await server.stop(true);
    redis.disconnect();
    await db.close();
  };
}, 120_000);
afterAll(async () => {
  await stop2?.();
  await c?.stop();
});

const A4 = "Giấy A4";
type Who = typeof P.hoa;
/** GET/PUT qua instance `A` (c.hub) hoặc `B` (app thứ hai), cùng token. */
async function via(
  inst: "A" | "B",
  who: Who,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const base = inst === "A" ? c.hub.base : base2;
  const res = await fetch(`${base}/pack/contracts${path}`, {
    method,
    headers: { authorization: `Bearer ${await c.tok(who)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : undefined };
}
const a4 = (r: { json: Json }) => r.json.lines.find((l: { name: string }) => l.name === A4);

async function world() {
  await arrangeW1(c);
  const m1 = await priced(c.sql, {
    partner: "NCC Một",
    tax: "0300000001",
    number: "M-1",
    items: [{ name: A4, price: 50_000 }],
  });
  const m2 = await priced(c.sql, {
    partner: "NCC Hai",
    tax: "0300000002",
    number: "M-2",
    items: [{ name: A4, price: 60_000 }],
  });
  const s1 = await priced(c.sql, {
    sale: true,
    partner: "Khách An",
    tax: "0400000001",
    number: "S-1",
    items: [{ name: A4, price: 80_000, qty: 10 }],
  });
  return { m1, m2, s1 };
}

describe("W1b · nhiều instance hub-api dùng chung DB", () => {
  it("hai instance cùng thấy dữ liệu; sau khi sửa giá HĐ (version tăng) CẢ HAI thấy ngay ở request kế (không cần khởi động lại)", async () => {
    const w = await world();
    for (const i of ["A", "B"] as const)
      expect(a4(await via(i, P.hoa, "GET", "/sourcing"))).toMatchObject({ margin: 30_000 });
    await c.sql`update contracts.contract_items set unit_price = 45000 where contract_id = ${w.m1} and ord = 0`;
    await c.sql`update contracts.contracts set version = version + 1, updated_at = now() where id = ${w.m1}`;
    for (const i of ["B", "A"] as const)
      expect(a4(await via(i, P.hoa, "GET", "/sourcing"))).toMatchObject({
        margin: 35_000,
        source: { price: 45_000 },
      });
  });
  it("đổi nguồn qua instance này ⇒ instance kia thấy ngay, và ngược lại; bỏ chọn cũng vậy", async () => {
    const w = await world();
    await via("A", P.hoa, "GET", "/sourcing");
    await via("B", P.hoa, "GET", "/sourcing"); // cả hai bộ nhớ đệm đã nóng
    expect(
      (await via("A", P.hoa, "PUT", `/sourcing/${w.s1}/0`, { contract_id: w.m2, line: 0 })).status,
    ).toBe(200);
    expect(a4(await via("B", P.hoa, "GET", "/sourcing"))).toMatchObject({
      source: { contract_id: w.m2, mode: "chosen" },
    });
    expect(
      (await via("B", P.hoa, "PUT", `/sourcing/${w.s1}/0`, { contract_id: null })).status,
    ).toBe(200);
    expect(a4(await via("A", P.hoa, "GET", "/sourcing"))).toMatchObject({
      source: { contract_id: w.m1, mode: "auto" },
    });
  });
  it("đổi trạng thái HĐ (không đổi version) và thêm HĐ mới ở một nơi ⇒ cả hai instance cập nhật; luật thấy vẫn theo từng người", async () => {
    const w = await world();
    for (const i of ["A", "B"] as const) await via(i, P.hoa, "GET", "/sourcing");
    await c.sql`update contracts.contracts set status = 'expiring' where id = ${w.m1}`;
    for (const i of ["A", "B"] as const)
      expect(a4(await via(i, P.hoa, "GET", "/sourcing"))).toMatchObject({
        risk: "source_expiring",
      });
    await priced(c.sql, { partner: "NCC Ba", number: "M-3", items: [{ name: A4, price: 10_000 }] });
    for (const i of ["B", "A"] as const)
      expect(a4(await via(i, P.hoa, "GET", "/sourcing"))).toMatchObject({
        source: { price: 10_000 },
      });
    // tenant khác không lẫn qua bộ nhớ đệm của instance nào
    for (const i of ["A", "B"] as const)
      expect((await via(i, P.an, "GET", "/sourcing")).json.lines).toEqual([]);
    expect(T.acme).not.toBe(T.beta);
  });
  it("lượt đọc đồng thời trên hai instance trong lúc dữ liệu đổi luôn trả 200 và kết quả nhất quán (cũ hoặc mới, không lỗi)", async () => {
    const w = await world();
    const reads = async () =>
      Promise.all(
        Array.from({ length: 6 }, (_, k) => via(k % 2 ? "A" : "B", P.hoa, "GET", "/sourcing")),
      );
    await reads();
    const change = c.sql`update contracts.contracts set version = version + 1, updated_at = now() where id = ${w.m2}`;
    const got = await Promise.all([reads(), change]);
    expect(got[0].every((r) => r.status === 200)).toBe(true);
    expect(d(0)).toBeString();
  });
});
