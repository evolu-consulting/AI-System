// CR-122 · E6 · int (Hono thật defs/library/company-flows + DB thật `hub_api`): xuất bản flow Thư viện CÓ trigger (không khe) — tạo
// → xuất bản (v+1) → gán công ty → sự kiện `contract.submitted` mở đúng 1 lượt, chạy từ BẢN XUẤT BẢN (không phải nháp); flow lỗi ⇒ 422
// `PROCESS_DEF_INVALID` + `paths`, không ghi bản; def theo khe cũ xuất bản như trước (đường B2 khe).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/public";
import { approvalEngineTools, approvalSlotSpec } from "../../packs/contracts/testing";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryFlowDef } from "../runs/runs.repo";
import { dispatchOnce, type FlowLaunch } from "../triggers/dispatcher";
import { insertFlowEvents } from "../triggers/dispatcher.repo";
import { setFlowTriggers } from "../triggers/flags";
import { bindGroupKeys, groupKeysOf } from "../triggers/group-keys.rules";
import { companyFlowsRoutes } from "./company-flows.routes";
import { libraryRoutes } from "./library.routes";

/** Khe `contracts.approval` thật + catalog tool hệ thống (như library.routes.int.test) — chỉ cho ca "def khe cũ". */
function registerApprovalSlotForTest(): PackToolCatalog {
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  return {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
}

const X = tenantId(1261);
const UP = userId(1260);
const UX = userId(1261);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: UP, tenantId: X, role: "platform_admin" },
  A: { userId: UX, tenantId: X, role: "tenant_admin" },
};
const T0 = new Date(Date.now() + 60_000);
const EVENT = "contract.submitted";
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const launched: string[] = [];
const launch: FlowLaunch = async (e, c) => {
  launched.push(`${e.ref}|${c.defKey}`);
  return { runId: crypto.randomUUID() };
};

async function call(method: string, path: string, body?: unknown, who = "P") {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const stage = (key: string, step: number, extra: object = {}) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor: { kind: "set", values: [{ key: "x", from: { const: "1" } }] },
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# x",
    required_sections: ["x"],
    fields: [{ key: "x", type: "string", required: false }],
  },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  ...extra,
});
const body = (key: string, extra: object = {}) => ({
  key,
  name: `Flow ${key}`,
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages: [stage("dau", 0), stage("xong", 1, { outcome: "approved" })],
  token_budget: null,
  enabled: true,
  sources: [],
  inputs: [],
  trigger: { event: EVENT },
  app: "contracts",
  ...extra,
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1261', 'X')`;
  await users(o, X, 2, { from: 1260 });
  const packTools = registerApprovalSlotForTest();
  const deps = { db, packTools, start: {} } as unknown as ProcessDeps;
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
  app.route("/", defsRoutes(deps));
  app.route("/", libraryRoutes(deps));
  app.route("/", companyFlowsRoutes(deps));
}, 180_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 E6 · xuất bản flow Thư viện có trigger", () => {
  it("tạo → xuất bản v1 → gán công ty → sự kiện mở đúng 1 lượt từ BẢN XUẤT BẢN; xuất bản lại ⇒ v2", async () => {
    const c = await call("POST", "/process-defs", body("e6-duyet"));
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    // def Thư viện (tenant NULL, không khe, có trigger) thấy trong danh sách Thư viện, không lẫn vào "mẫu".
    const lib = await call("GET", "/process-defs?kind=library&limit=100");
    expect((lib.json.items as Json[]).some((i) => i.id === id)).toBe(true);
    const tpl = await call("GET", "/process-defs?kind=template&limit=100");
    expect((tpl.json.items as Json[]).some((i) => i.id === id)).toBe(false);

    const pub = await call("POST", `/process-defs/${id}/publish`, { version: c.json.version });
    expect([pub.status, pub.json]).toEqual([201, { rel_version: 1 }]);
    const [rel] = await o<{ pv: number; n: number }[]>`select d.published_version as pv,
        (select count(*)::int from hub.process_def_releases r where r.def_id = d.id) as n
      from hub.process_defs d where d.id = ${id}`;
    expect([rel?.pv, rel?.n]).toEqual([1, 1]);

    const asg = await call("POST", `/tenants/${X}/company-flows`, { flow_id: id });
    expect(asg.status).toBe(201);
    await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, X, true));
    await withHubScope(db, { kind: "user", tenantId: X, userId: UX }, (tx) =>
      insertFlowEvents(tx, [
        {
          tenantId: X,
          eventId: "e6:1",
          event: EVENT,
          ref: "r-e6",
          facts: {} as never,
          actorId: UX,
        },
      ]),
    );
    launched.length = 0;
    await dispatchOnce({ db, launch, now: () => T0 });
    expect(launched).toEqual(["r-e6|e6-duyet"]);

    // Chạy từ bản xuất bản: sửa nháp sau đó KHÔNG đổi bước mà dispatcher/launch đọc.
    await o`update hub.process_defs set stages = '[{"key":"nhap"}]'::jsonb where id = ${id}`;
    const run = await withHubScope(db, { kind: "system" }, (tx) => libraryFlowDef(tx, id));
    expect(((run?.stages ?? []) as { key: string }[]).map((s) => s.key)).toEqual(["dau", "xong"]);

    // Nhân bản + xuất bản lại: clone giữ trigger/app; def gốc xuất bản v2 sau khi nháp được sửa lại hợp lệ.
    const cl = await call("POST", `/process-defs/${id}/clone`, { key: "e6-duyet-2" });
    expect(cl.status).toBe(201);
    expect([cl.json.trigger, cl.json.app]).toEqual([{ event: EVENT }, "contracts"]);
    const cur = (await call("GET", `/process-defs/${id}`)).json;
    const put = await call("PUT", `/process-defs/${id}`, {
      ...body("e6-duyet"),
      version: cur.version,
    });
    expect(put.status).toBe(200);
    const p2 = await call("POST", `/process-defs/${id}/publish`, { version: put.json.version });
    expect([p2.status, p2.json]).toEqual([201, { rel_version: 2 }]);
  });

  it("flow lỗi ⇒ 422 PROCESS_DEF_INVALID + paths, không tạo bản xuất bản", async () => {
    const c = await call("POST", "/process-defs", body("e6-loi"));
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    // Hỏng sau khi lưu (vd sửa DB/nhập cũ): không còn bước Kết thúc.
    await o`update hub.process_defs set stages = ${o.json([stage("dau", 0)] as never)} where id = ${id}`;
    const r = await call("POST", `/process-defs/${id}/publish`, { version: c.json.version });
    expect(r.status).toBe(422);
    expect(r.json.error?.code ?? r.json.code).toBe("PROCESS_DEF_INVALID");
    expect(JSON.stringify(r.json)).toContain("stages");
    const [n] = await o<{ n: number; pv: number | null }[]>`select
        (select count(*)::int from hub.process_def_releases where def_id = ${id}) as n,
        (select published_version from hub.process_defs where id = ${id}) as pv`;
    expect([n?.n, n?.pv]).toEqual([0, null]);
  });

  it("tenant_admin chỉ mở (chỉ đọc) def Thư viện có trigger khi ĐÃ gán cho công ty của mình", async () => {
    const c = await call("POST", "/process-defs", body("e6-xem"));
    const id = c.json.id as string;
    await call("POST", `/process-defs/${id}/publish`, { version: c.json.version });
    expect((await call("GET", `/process-defs/${id}`, undefined, "A")).status).toBe(404); // chưa gán ⇒ ẩn
    expect((await call("POST", `/tenants/${X}/company-flows`, { flow_id: id })).status).toBe(201);
    const g = await call("GET", `/process-defs/${id}`, undefined, "A");
    expect([g.status, g.json.id]).toEqual([200, id]);
  });

  // CR-122 · P6 · lỗi sản phẩm #6: flow Thư viện lưu/bật/xuất bản với node Duyệt theo MÃ Group, không đòi `group_id`.
  it("P6 · flow Thư viện có node Duyệt theo group_key: tạo + bật + xuất bản + gán công ty ⇒ Group duyệt = id của công ty", async () => {
    const gx = await groups(o, X, ["kinh-doanh"]);
    const review = stage("duyet", 1, {
      after: { kind: "review", group_key: "kinh-doanh", back_to_steps: [] }, // KHÔNG có group_id
    });
    const stages = [stage("dau", 0), review, stage("xong", 2, { outcome: "approved" })];
    const c = await call("POST", "/process-defs", body("p6-duyet", { stages, enabled: true }));
    expect([c.status, c.json.enabled]).toEqual([201, true]);
    const id = c.json.id as string;
    const cur = (await call("GET", `/process-defs/${id}`)).json;
    const put = await call("PUT", `/process-defs/${id}`, {
      ...body("p6-duyet", { stages, enabled: true }),
      version: cur.version,
    });
    expect(put.status).toBe(200);
    const pub = await call("POST", `/process-defs/${id}/publish`, { version: put.json.version });
    expect([pub.status, pub.json]).toEqual([201, { rel_version: 1 }]);
    expect((await call("POST", `/tenants/${X}/company-flows`, { flow_id: id })).status).toBe(201);
    // Đúng bước mở lượt (`flow-launch.libraryDefFor`): bản xuất bản + mã → id Group của công ty ⇒ task duyệt giao đúng nhóm.
    const def = await withHubScope(db, { kind: "system" }, (tx) => libraryFlowDef(tx, id));
    const keys = groupKeysOf(def?.stages ?? []);
    expect(keys).toEqual(["kinh-doanh"]);
    const bound = bindGroupKeys(
      def?.stages ?? [],
      new Map([["kinh-doanh", gx.get("kinh-doanh") as string]]),
    );
    expect(bound.missing).toEqual([]);
    const after = (bound.stages[1] as { after: { group_id: string } }).after;
    expect(after.group_id).toBe(gx.get("kinh-doanh") as string);
  });

  // CR-122 · P15: def công ty lưu id; mã hợp lệ của công ty tự đổi sang id, mã lạ ⇒ 422 câu nghiệp vụ (không còn PROCESS_REF_INVALID).
  it("P6/P15 · def của công ty: group_key lạ ⇒ 422 GROUPS_MISSING nêu mã", async () => {
    const review = stage("duyet", 1, {
      after: { kind: "review", group_key: "khong-co-nhom", back_to_steps: [] },
    });
    const stages = [stage("dau", 0), review, stage("xong", 2, { outcome: "approved" })];
    const r = await call(
      "POST",
      `/process-defs?tenant_id=${X}`,
      body("p6-cty", { stages, enabled: false, trigger: undefined, app: undefined }),
    );
    expect(r.status).toBe(422);
    expect(r.json.error?.code ?? r.json.code).toBe("GROUPS_MISSING");
    expect(JSON.stringify(r.json)).toContain("Nhóm khong-co-nhom chưa có ở công ty");
  });

  const reviewStages = (after: object) => [
    stage("dau", 0),
    stage("duyet", 1, { after: { kind: "review", back_to_steps: [], ...after } }),
    stage("xong", 2, { outcome: "approved" }),
  ];
  /** Tạo + xuất bản flow Thư viện (người duyệt theo mã), gán cho X, rồi tenant_admin "Sao chép để sửa". */
  async function cloneLib(key: string, groupKey: string) {
    const c = await call(
      "POST",
      "/process-defs",
      body(key, { stages: reviewStages({ group_key: groupKey }) }),
    );
    expect(c.status).toBe(201);
    const id = c.json.id as string;
    await call("POST", `/process-defs/${id}/publish`, { version: c.json.version });
    const asg = await call("POST", `/tenants/${X}/company-flows`, { flow_id: id });
    const rowId = (asg.json.items as Json[]).find((x) => x.flow_id === id)?.id;
    const cl = await call("POST", `/tenants/${X}/company-flows/${rowId}/clone`, undefined, "A");
    const copy = (cl.json.items as Json[]).find((x) => x.id === cl.json.id);
    const [d] = await o<
      { s: Json[] }[]
    >`select stages as s from hub.process_defs where id = ${copy?.flow_id}`;
    return { cl, copy, after: d?.s[1]?.after as Json, fid: copy?.flow_id as string };
  }
  const putCopy = async (fid: string, after: object) => {
    const cur = (await call("GET", `/process-defs/${fid}`, undefined, "A")).json;
    return call(
      "PUT",
      `/process-defs/${fid}`,
      {
        ...body(cur.key, { name: cur.name, stages: reviewStages(after), trigger: cur.trigger }),
        version: cur.version,
      },
      "A",
    );
  };

  it("P15 · sao chép flow Thư viện có Duyệt theo key ⇒ bản sao có group_id (không còn key); PUT đổi người duyệt (id hoặc key cũ) ⇒ 200", async () => {
    const gx = await groups(o, X, ["p15-a", "p15-b"]);
    const { cl, copy, after, fid } = await cloneLib("p15-ok", "p15-a");
    expect(cl.status).toBe(201);
    expect(cl.json.missing_group_keys).toBeUndefined();
    expect(copy?.warnings).toEqual([]);
    expect(after.group_id).toBe(gx.get("p15-a") as string);
    expect(after.group_key).toBeUndefined();
    const byId = await putCopy(fid, { group_id: gx.get("p15-b") });
    expect(byId.status).toBe(200);
    expect(byId.json.stages[1].after.group_id).toBe(gx.get("p15-b") as string);
    const byKey = await putCopy(fid, { group_key: "p15-a" }); // client cũ gửi mã
    expect(byKey.status).toBe(200);
    expect(byKey.json.stages[1].after).toMatchObject({ group_id: gx.get("p15-a") });
    expect(byKey.json.stages[1].after.group_key).toBeUndefined();
  });

  it("P15 · mã nhóm chưa có ở công ty ⇒ bản sao VẪN lưu được, trống nhóm + cảnh báo nêu mã; chọn nhóm khác ⇒ PUT 200", async () => {
    const gx = await groups(o, X, ["p15-c"]);
    const { cl, copy, after, fid } = await cloneLib("p15-thieu", "p15-thieu-nhom");
    expect(cl.status).toBe(201);
    expect(cl.json.missing_group_keys).toEqual(["p15-thieu-nhom"]);
    expect(cl.json.message).toBe("Nhóm p15-thieu-nhom chưa có ở công ty — chọn nhóm khác.");
    expect(copy?.warnings).toEqual(["group_missing"]);
    expect([after.group_id, after.group_key]).toEqual([null, undefined]);
    const put = await putCopy(fid, { group_id: gx.get("p15-c") });
    expect(put.status).toBe(200);
    const l = await call("GET", `/tenants/${X}/company-flows`, undefined, "A");
    expect((l.json.items as Json[]).find((x) => x.flow_id === fid)?.warnings).toEqual([]);
  });

  it("def theo khe cũ xuất bản như trước (luật khe + nút hệ thống)", async () => {
    const cl = await call("POST", `/process-defs/${APPROVAL_DEFAULT_DEF.id}/clone`, {
      key: "e6-khe",
    });
    expect(cl.status).toBe(201);
    const pub = await call("POST", `/process-defs/${cl.json.id}/publish`, {
      version: cl.json.version,
    });
    expect([pub.status, pub.json]).toEqual([201, { rel_version: 1 }]);
  });
});
