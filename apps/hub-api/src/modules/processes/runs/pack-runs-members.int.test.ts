// fix-cr181-uat · lỗi 2 · tên người ký kiểu NHÓM ở bước «Ký hợp đồng»: «<nhóm>: <tên người>» (nhiều người ⇒ «Hùng, Mai»), từ DB thật.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { membersLabel } from "@ai/contracts/pack-contracts";
import { withHubScope } from "@ai/db/hub-scope";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { type ClaimWorld, claimWorld } from "../testing/claim-seed";
import { signerNamesOf } from "./pack-runs-modules";

let o: Sql;
let db: Db;
let w: ClaimWorld;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  w = await claimWorld(o, 9871);
}, 300_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

describe("signerNamesOf · nhóm ký có thành viên", () => {
  it("«<nhóm>: <tên thành viên>», nhóm không ai ⇒ chỉ tên nhóm, người ⇒ tên người", async () => {
    const mem = await o<
      { n: string }[]
    >`select coalesce(nullif(u.display_name, ''), u.username) as n
      from admin.group_members m join admin.users u on u.id = m.user_id and u.tenant_id = m.tenant_id
      where m.tenant_id = ${w.T} and m.group_id = ${w.G}::uuid order by u.display_name, u.username`;
    expect(mem.length).toBeGreaterThan(0);
    const [g] = await o<
      { n: string }[]
    >`select coalesce(nullif(name->>'vi', ''), nullif(name->>'en', ''), key) as n
      from admin.groups where id = ${w.G}::uuid`;
    const [empty] = await o<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
      values (${w.T}, 'khong-ai-9871', ${o.json({ vi: "Nhóm trống" } as never)}) returning id::text as id`;
    const out = await withHubScope(db, { kind: "system" }, (tx) =>
      signerNamesOf(tx, w.T, [`group:${w.G}`, `group:${empty?.id}`, `user:${w.A}`]),
    );
    expect(out.get(`group:${w.G}`)).toBe(`${g?.n}: ${membersLabel(mem.map((m) => m.n))}`);
    expect(out.get(`group:${empty?.id}`)).toBe("Nhóm trống");
    expect(out.get(`user:${w.A}`)).toBeTruthy();
  });
});
