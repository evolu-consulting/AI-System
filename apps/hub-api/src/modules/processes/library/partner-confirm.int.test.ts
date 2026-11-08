// CR-125 · UX-S7 (H7) · int (Hono thật `companyFlowsRoutes` + DB thật): `GET /tenants/:tid/partner-confirm/readiness` — phần Hub của danh sách điều kiện
// Đối tác xác nhận hợp đồng: kênh, flow nhận (mẫu «Nhận HĐ thường» hub 0121), flow gửi (bước «Gửi đối tác xác nhận»), nhóm xác nhận (thiếu / trống / đủ).
// Quyền: platform xem mọi công ty; quản trị công ty chỉ công ty mình (công ty khác ⇒ 404).
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
import { companyFlowsRoutes } from "./company-flows.routes";

const X = tenantId(1281);
const Z = tenantId(1282);
const RECEIVE_TPL = "0c124000-0000-4000-8000-0000000000c2"; // «Nhận HĐ thường» (hub 0121)
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1280), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1281), tenantId: X, role: "tenant_admin" },
  AZ: { userId: userId(1283), tenantId: Z, role: "tenant_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let channelOn = true;

async function get(who: string, tid: string) {
  const r = await app.request(`/tenants/${tid}/partner-confirm/readiness`, {
    headers: { "x-who": who },
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}
const assign = (tid: string, flowId: string) =>
  app.request(`/tenants/${tid}/company-flows`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-who": "P" },
    body: JSON.stringify({ flow_id: flowId }),
  });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1281', 'X'), (${Z}, 't1282', 'Z')`;
  await users(o, X, 2, { from: 1280 });
  await users(o, Z, 1, { from: 1283 });
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
  // `partnerMailbox` đọc theo từng lần gọi qua getter: đổi `channelOn` ⇒ đổi kênh mà không dựng lại app.
  app.route(
    "/",
    companyFlowsRoutes({
      db,
      get partnerMailbox() {
        return channelOn;
      },
    } as unknown as ProcessDeps),
  );
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-125 UX-S7 · điều kiện Đối tác xác nhận (phần Hub)", () => {
  it("công ty trắng: có mẫu nhận để gán, chưa có flow, nhóm phong-kinh-doanh chưa có", async () => {
    const r = await get("P", X);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({
      channel: true,
      receive_template_id: RECEIVE_TPL,
      receive_flow: false,
      send_flow: false,
      groups: [{ key: "phong-kinh-doanh", exists: false, members: 0 }],
    });
  });

  it("kênh hệ thống tắt ⇒ channel=false", async () => {
    channelOn = false;
    expect((await get("P", X)).json.channel).toBe(false);
    channelOn = true;
  });

  it("làm từng bước bằng đúng đường có sẵn: tạo nhóm (trống → có người) và Gán mẫu nhận ⇒ từng điều kiện đổi", async () => {
    const g = [...(await groups(o, X, ["phong-kinh-doanh"])).values()][0] as string;
    expect((await get("A", X)).json.groups).toEqual([
      { key: "phong-kinh-doanh", exists: true, members: 0 },
    ]);
    await o`insert into admin.group_members (tenant_id, group_id, user_id) values (${X}, ${g}, ${userId(1281)})`;
    expect((await get("A", X)).json.groups).toEqual([
      { key: "phong-kinh-doanh", exists: true, members: 1 },
    ]);
    expect((await assign(X, RECEIVE_TPL)).status).toBe(201);
    expect((await get("A", X)).json.receive_flow).toBe(true);
  });

  it("flow công ty có bước «Gửi đối tác xác nhận» đang bật ⇒ send_flow=true; công ty khác không bị ảnh hưởng", async () => {
    expect((await get("AZ", Z)).json).toMatchObject({ send_flow: false, receive_flow: false });
    const stages = JSON.stringify([
      {
        key: "gui",
        name: "Gửi đối tác",
        step: 0,
        node: "contracts.partner-send",
        executor: { kind: "tool", tool_key: "contracts-partner-send", args: {} },
      },
    ]);
    const [d] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app)
      values (${X}, 'ux-s7-gui', 'Gửi đối tác', ${stages}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts')
      returning id::text as id`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled, position) values (${X}, ${d?.id as string}, true, 1)`;
    expect((await get("A", X)).json.send_flow).toBe(true);
    expect((await get("AZ", Z)).json.send_flow).toBe(false);
  });

  it("quyền: quản trị công ty khác hỏi công ty X ⇒ 404 (không lộ), quản trị chính công ty ⇒ 200", async () => {
    expect((await get("AZ", X)).status).toBe(404);
    expect((await get("AZ", Z)).status).toBe(200);
  });
});
