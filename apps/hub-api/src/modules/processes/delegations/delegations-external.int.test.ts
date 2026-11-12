// SEC 2026-11-12 · CR-127 E3 · int (DB thật, role `hub_api`): uỷ quyền chỉ giữa người nội bộ — đích là user đối tác
// (`admin.users.kind='external'`) ⇒ `DELEGATE_NO_ACCESS`, không ghi hàng (việc không bị kẹt ở người không xử lý được).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import type { ProcessDeps } from "../core/ports";
import { type ClaimWorld, claimWorld } from "../testing/claim-seed";
import { DelegationsService } from "./delegations.service";

let o: Sql;
let db: Db;
let w: ClaimWorld;
let EXT: string;
const H = 3_600_000;
const who = (userId: string) => ({ userId, tenantId: w.T, role: "member" }) as never;
const svc = () => new DelegationsService({ db } as unknown as ProcessDeps);
const span = () => ({
  from_at: new Date(Date.now() - H).toISOString(),
  to_at: new Date(Date.now() + 24 * H).toISOString(),
  kinds: ["approve"] as never,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  w = await claimWorld(o, 1277);
  const [org] = await o<{ id: string }[]>`insert into admin.external_orgs (tenant_id, name)
    values (${w.T}, 'Đối tác') returning id::text as id`;
  const [u] = await o<
    { id: string }[]
  >`insert into admin.users (tenant_id, username, email, password_hash,
      display_name, role, kind, external_org_id)
    values (${w.T}, 'ext-1277', 'ext-1277@kit.test', 'x', 'Đối tác 1', 'member', 'external', ${org?.id as string})
    returning id::text as id`;
  EXT = u?.id as string;
  db = connectDb(urls().hubApi, 4);
}, 300_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("SEC · uỷ quyền cho user đối tác bị chặn", () => {
  it("A uỷ quyền cho user đối tác ⇒ DELEGATE_NO_ACCESS, không ghi; cho nội bộ B vẫn được", async () => {
    let code: string | undefined;
    try {
      await svc().create(who(w.A), { to_user_id: EXT, ...span() });
    } catch (e) {
      code = (e as { code?: string }).code;
    }
    expect(code).toBe("DELEGATE_NO_ACCESS");
    const [n] = await o<{ n: number }[]>`select count(*)::int as n from hub.delegations
      where tenant_id = ${w.T} and to_user_id = ${EXT}`;
    expect(n?.n).toBe(0);
    const ok = await svc().create(who(w.A), { to_user_id: w.B, ...span() });
    expect(ok.id).toBeTruthy();
  });
});
