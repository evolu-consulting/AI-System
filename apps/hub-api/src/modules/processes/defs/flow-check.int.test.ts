// fix-review-r2 · `trigger.params.owner_user_id` của quy trình «Nhận HĐ từ đối tác»: khi LƯU phải là người nội bộ, đang hoạt động, không bị khoá,
// đúng công ty (một câu exists, DB thật, vai hub trong scope user của tenant như lúc ghi cấu hình) ⇒ 422 PROCESS_DEF_INVALID theo trường.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { createDb, type Db } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { RECEIVE_OWNER_PATH, receiveOwnerCheck } from "./flow-check";

let o: Sql;
let db: Db;
let X = "";
let Y = "";
let ok = "";
let external = "";
let inactive = "";
let locked = "";
let other = "";

const input = (owner: string | undefined, event = "contract.received"): ProcessDefInput =>
  ({
    key: "r2-owner",
    name: "r2",
    stages: [],
    trigger: { event, params: owner === undefined ? {} : { owner_user_id: owner } },
  }) as unknown as ProcessDefInput;
const check = (tid: string | null, i: ProcessDefInput) =>
  withHubScope(db, { kind: "user", tenantId: X, userId: ok }, (tx) =>
    receiveOwnerCheck(tx, tid, i),
  );
const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string; details?: { paths?: string[] } }) =>
      `${e.code}:${(e.details?.paths ?? []).join(",")}`,
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [X, Y] = (await tenants(o, 2, 1750)) as [string, string];
  [ok, external, inactive, locked] = (await users(o, X, 4, { from: 1750 })) as [
    string,
    string,
    string,
    string,
  ];
  [other] = (await users(o, Y, 1, { from: 1760 })) as [string];
  const [org] = await o<
    { id: string }[]
  >`insert into admin.external_orgs (tenant_id, name) values (${X}, 'Đối tác r2') returning id::text as id`;
  await o`delete from admin.users where id = ${external}`;
  await o`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, kind, external_org_id)
    values (${external}, ${X}, 'r2-ext', 'r2-ext@kit.test', 'x', 'Đối tác', 'member', 'external', ${org?.id as string}::uuid)`;
  await o`update admin.users set active = false where id = ${inactive}`;
  await o`update admin.users set locked_by_tenant = true where id = ${locked}`;
  db = createDb(urls().hubApi, { max: 2 });
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("fix-review-r2 · người phụ trách của quy trình Nhận HĐ khi lưu", () => {
  it("người nội bộ đang hoạt động của công ty ⇒ qua", async () => {
    expect(await code(check(X, input(ok)))).toBe("ok");
  });
  it("người công ty khác / bên ngoài / vô hiệu / bị khoá / không tồn tại ⇒ 422 PROCESS_DEF_INVALID, đường trigger.params.owner_user_id", async () => {
    for (const who of [other, external, inactive, locked, crypto.randomUUID()])
      expect(await code(check(X, input(who)))).toBe(`PROCESS_DEF_INVALID:${RECEIVE_OWNER_PATH}`);
  });
  it("không đặt người phụ trách / sự kiện khác / def thư viện (tenant null) ⇒ không kiểm", async () => {
    expect(await code(check(X, input(undefined)))).toBe("ok");
    expect(await code(check(X, input(other, "contract.submitted")))).toBe("ok");
    expect(await code(check(null, input(other)))).toBe("ok");
  });
});
