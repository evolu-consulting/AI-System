// CR-125 · c2 · "Lưu và áp dụng" / gán quy trình là ĐỦ để công ty dùng quy trình mới — không còn công tắc bật bắt buộc (Hono thật + DB thật):
// (1) công ty có sẵn dòng gán nhưng CHƯA áp dụng gì (như prod hôm nay) ⇒ cờ vẫn TẮT, chạy đúng như trước; sao chép cũng không bật;
// (2) áp dụng ⇒ cờ BẬT cùng giao dịch + audit ghi; (3) tạm dừng (cứu hộ) ⇒ TẮT, áp dụng lại ⇒ BẬT lại; (4) platform gán ⇒ BẬT; công ty khác không đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { seedCompanyCopy } from "../testing/company-copy-seed";
import { seedCompanyFlow } from "../testing/company-flow-seed";
import { companyFlowsRoutes } from "./company-flows.routes";

const W = tenantId(1271); // đã có dòng gán từ trước (kiểu prod), chưa áp dụng
const V = tenantId(1272); // platform gán mới
const Z = tenantId(1273); // không đụng tới
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1270), tenantId: W, role: "platform_admin" },
  AW: { userId: userId(1271), tenantId: W, role: "tenant_admin" },
  AZ: { userId: userId(1272), tenantId: Z, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let lib = "";

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const P = (t: string) => `/tenants/${t}/company-flows`;
const flag = async (who: string, t: string): Promise<boolean> =>
  (await call(who, "GET", `/tenants/${t}/flow-settings`)).json.flow_triggers as boolean;
const stages = [
  {
    key: "dau",
    name: "Đầu",
    step: 0,
    executor: { kind: "set", values: [] },
    after: { kind: "auto", branch: [] },
    answerer: { kind: "starter" },
    real_action: false,
  },
  {
    key: "xong",
    name: "Xong",
    step: 1,
    outcome: "approved",
    executor: { kind: "set", values: [] },
  },
];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${W}, 't1271', 'W'), (${V}, 't1272', 'V'), (${Z}, 't1273', 'Z')`;
  await users(o, W, 2, { from: 1270 });
  await users(o, Z, 1, { from: 1272 });
  await groups(o, W, ["kinh-doanh"]);
  const st = JSON.stringify(stages);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app,
      published_version) values (null, 'c2-duyet', 'c2-duyet', ${st}::text::jsonb, ${o.json({ event: "contract.submitted" } as never)}, 'contracts', 1)
    returning id::text as id`;
  lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'c2-duyet', ${st}::text::jsonb)`;
  // W: dòng gán có sẵn bằng SQL (không qua dịch vụ) — mô phỏng công ty prod đã có company_flows nhưng cờ TẮT
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${W}, ${lib}, true)`;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  app.route("/", companyFlowsRoutes({ db } as unknown as ProcessDeps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 · c2 · áp dụng / gán ⇒ đang dùng quy trình mới", () => {
  it("công ty có sẵn dòng gán nhưng chưa áp dụng ⇒ cờ TẮT (như trước), bản công ty có sẵn cũng không bật", async () => {
    expect(await flag("AW", W)).toBe(false);
    const l = await call("AW", "GET", P(W));
    const orig = (l.json.items as Json[]).find((x) => x.flow_id === lib) as Json;
    await seedCompanyCopy(o, { tenantId: W, srcFlowId: lib, actor: userId(1271) });
    expect(await flag("AW", W)).toBe(false);
  });

  it("Lưu và áp dụng ⇒ cờ BẬT cùng giao dịch + audit ghi flow_triggers, không cần bật công tắc riêng", async () => {
    const l = await call("AW", "GET", P(W));
    const copy = (l.json.items as Json[]).find((x) => x.kind === "company") as Json;
    const a = await call("P", "POST", `${P(W)}/apply`, { flow_id: copy.flow_id });
    expect(a.status).toBe(200);
    expect(await flag("AW", W)).toBe(true);
    const [au] = await o<
      { after: Json }[]
    >`select after from hub.audit_log where tenant_id = ${W} and entity_name = 'company_flow.apply' order by seq desc limit 1`;
    expect(au?.after.flow_triggers).toBe(true);
  });

  it("tạm dừng (cứu hộ) ⇒ TẮT, áp dụng lại ⇒ BẬT lại", async () => {
    expect(
      (await call("AW", "PUT", `/tenants/${W}/flow-settings`, { flow_triggers: false })).status,
    ).toBe(200);
    expect(await flag("AW", W)).toBe(false);
    const l = await call("AW", "GET", P(W));
    const copy = (l.json.items as Json[]).find((x) => x.kind === "company") as Json;
    await call("P", "POST", `${P(W)}/apply`, { flow_id: copy.flow_id });
    expect(await flag("AW", W)).toBe(true);
  });

  it("platform áp dụng quy trình công ty mới ⇒ BẬT, công ty không đụng tới ⇒ vẫn TẮT", async () => {
    expect(await flag("P", V)).toBe(false);
    const draft = await seedCompanyFlow(o, {
      tenantId: V,
      key: "c2-moi",
      trigger: { event: "contract.submitted" },
      applied: false,
    });
    expect((await call("P", "POST", `${P(V)}/apply`, { flow_id: draft.flowId })).status).toBe(200);
    expect(await flag("P", V)).toBe(true);
    expect(await flag("AZ", Z)).toBe(false);
  });
});
