// CR-122 · P4 · lỗi #5 (qc q1-e2e) · cổng `moderationOn` của Community: flow duyệt bài gán qua `company_flows` (sự kiện `post.created`,
// đang bật) + cờ FLOW_TRIGGERS bật ⇒ bài mới vào "Chờ duyệt" NGAY (không cache; gán/bật xong có hiệu lực ở lần đọc kế). Trước sửa: chỉ
// đọc luật định tuyến/`process_tenant_defs` cũ ⇒ gán flow mới không bao giờ làm bài "Chờ duyệt".
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { tenantId } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../lib/db";
import { setFlowTriggers } from "../processes/triggers/flags";
import { communityFlowPorts } from "./community-flow.mount";

const X = tenantId(1271);
const ST = JSON.stringify([
  {
    key: "duyet",
    name: "Duyệt",
    step: 0,
    executor: { kind: "set", values: [] },
    instruction: "",
    output: { filename: "n.md", template: "# n", required_sections: ["n"], fields: [] },
    after: { kind: "auto", branch: [] },
    real_action: false,
    answerer: { kind: "starter" },
    token_budget: null,
    outcome: "accepted",
  },
]);
let o: Sql;
let db: Db;
let flowId = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1271', 'X')`;
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'p4-post-mod', 'Duyệt bài', ${ST}::text::jsonb, '{"event":"post.created"}'::jsonb, 'community', 1, true)
    returning id::text as id`;
  flowId = d?.id as string;
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 P4 · #5 community moderationOn theo flow đã gán", () => {
  it("gán flow post.created → chưa bật cờ: chưa duyệt; bật cờ ⇒ duyệt ngay; tắt flow ⇒ thôi", async () => {
    const { moderationOn } = communityFlowPorts(db, undefined);
    const on = (t: boolean) =>
      withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, t));
    expect(await moderationOn?.(X)).toBe(false);
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${X}, ${flowId}, true)`;
    expect(await moderationOn?.(X)).toBe(false); // cờ tắt = bóng, đường khe cũ quyết
    await on(true);
    expect(await moderationOn?.(X)).toBe(true); // vừa bật cờ ⇒ có hiệu lực ngay
    await o`update hub.company_flows set enabled = false where tenant_id = ${X}`;
    expect(await moderationOn?.(X)).toBe(false);
  });
});
