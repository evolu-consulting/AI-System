// CR-125 · x6 · Luật 4c: phong bì ký số đổi trạng thái (webhook/đồng bộ) ⇒ hub ĐẨY `esign.updated` qua `ustream:<user>` (Redis thật) cho
// người gửi + người ký của ĐÚNG HĐ — không cho người khác cùng tenant, không cho tenant khác. DB thật (pool hub_api), nhà cung cấp GIẢ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createRedis, type Redis } from "../../../../lib/redis";
import { publishUserEvents, userStreamKey } from "../../../../lib/user-stream";
import type { ESignFiles } from "../application/esign.ports";
import { esignModule } from "../esign.mount";
import { type FakeESign, fakeESign } from "./esign.fake";

const REDIS_TEST_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";
let sql: Sql;
let db: Db;
let redis: Redis;
let T1 = "";
let T2 = "";
let O1 = "";
let W1 = ""; // cùng tenant T1, KHÔNG liên quan phong bì
let O2 = "";
const k: string[] = [];
let fake: FakeESign;
const files: ESignFiles = () => ({
  getContent: async () => null,
  postFile: async () => ({ fileId: "f", versionId: "v" }),
  getLink: async () => null,
  deleteFile: async () => null,
});

async function seed(tid: string, cid: string, owner: string, env: string) {
  await sql`insert into contracts.esign_envelopes (tenant_id, contract_id, provider, envelope_id, signers, sent_by)
    values (${tid}, ${cid}, 'fake', ${env},
      ${sql.json([{ role: "company", name: "A", email: "a@x.vn", order: 1, client_user_id: owner }] as never)}, ${owner})`;
  fake.envelopes.set(env, {
    id: env,
    status: "sent",
    subject: "s",
    signers: [{ name: "A", email: "a@x.vn", order: 1, status: "sent", signedAt: null }],
    reason: null,
    completedAt: null,
    pdf: new Uint8Array(),
  } as never);
}

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  [T1, T2] = (await tenants(sql, 2, 1251)) as [string, string];
  [O1, W1] = (await users(sql, T1, 2, { from: 125_100 })) as [string, string];
  [O2] = (await users(sql, T2, 1, { from: 125_200 })) as [string];
  k.push(...(await contracts(sql, T1, 1, { from: 125_100, createdBy: O1, owner: O1 })));
  k.push(...(await contracts(sql, T2, 1, { from: 125_200, createdBy: O2, owner: O2 })));
  fake = fakeESign();
  await seed(T1, k[0] as string, O1, "p1");
  await seed(T2, k[1] as string, O2, "p2");
  fake.complete("p1");
  db = createDb(urls().hubApi, { max: 4 });
  redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  for (const u of [O1, W1, O2]) await redis.del(userStreamKey(u));
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
  redis?.disconnect();
});

const entries = async (uid: string) =>
  (await redis.xrange(userStreamKey(uid), "-", "+")).map(
    ([, f]) => JSON.parse(f[1] as string) as { event: string; data: Record<string, string> },
  );

describe("CR-125 · x6 · đẩy esign.updated", () => {
  it("esign.updated chỉ tới người gửi và người ký của đúng HĐ", async () => {
    const providers = [fake];
    const u = esignModule(db, {
      esign: { providers },
      files,
      publish: (userIds, contractId, status) =>
        publishUserEvents(
          redis,
          [{ userIds, event: "esign.updated", data: { contract_id: contractId, status } }],
          { warn: () => undefined },
        ),
    });
    expect(await u.syncEnvelope(T1, "fake", "p1")).toBe(true);
    expect(await entries(O1)).toEqual([
      { event: "esign.updated", data: { contract_id: k[0] as string, status: "completed" } },
    ]);
    expect(await entries(W1)).toEqual([]); // cùng tenant, không liên quan phong bì
    expect(await entries(O2)).toEqual([]); // tenant khác: phong bì p2 chưa đổi, không nhận gì của T1
  });
});
