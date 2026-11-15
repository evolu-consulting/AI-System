// CR-127 · M4 · int (DB thật, pool hub_api): `flowEngineOf().availability.outline` — các bước HĐ SẼ đi qua theo dữ kiện hiện tại, CÙNG chọn quy
// trình với `hasFlowFor`. Quy trình Thư viện (bản xuất bản) có node Nếu "giá trị > 500 triệu" ⇒ Đúng: qua thêm bước Giám đốc; Sai: bỏ qua.
// Không quy trình đang bật ⇒ null. Chỉ đọc: số hàng run/task/event không đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { department, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../lib/db";
import { flowEngineOf } from "../runs/flow-engine";

let o: Sql;
let db: Db;
let T = "";
let T0 = "";
let U1 = "";
let U2 = "";
let U3 = "";

const stage = (
  key: string,
  name: string,
  step: number,
  executor: object,
  after: object,
  more: object = {},
) => ({
  key,
  name,
  step,
  executor,
  after,
  real_action: false,
  ...more,
});
const review = (groupKey: string) => ({
  kind: "review",
  group_id: null,
  group_key: groupKey,
  back_to_steps: [],
  branch: [],
});
const APPROVE = { kind: "approve", reject_step: null, return_step: null };
const STAGES = [
  stage("kd", "Truong phong KD duyet", 0, APPROVE, review("pb-kd")),
  stage(
    "ktra",
    "Gia tri tren 500 trieu?",
    1,
    {
      kind: "if",
      when: {
        op: "and",
        conds: [{ from: { kind: "fact", key: "total_value" }, op: "gt", value: 500_000_000 }],
      },
      then_step: 2,
      else_step: 3,
    },
    { kind: "auto", branch: [] },
  ),
  stage("gd", "Giam doc duyet", 2, APPROVE, {
    ...review("pb-gd"),
    escalate: { after_h: 24, group_id: null, user_id: null },
  }),
  stage(
    "ky",
    "Ky so",
    3,
    { kind: "tool", tool_key: "contracts-esign", args: {} },
    { kind: "auto", branch: [] },
    { node: "contracts.esign" },
  ),
  stage("xong", "Xong", 4, { kind: "notify" }, { kind: "auto" }, { outcome: "approved" }),
];

const q = (tenantId: string, facts: Record<string, unknown>) => ({
  tenantId,
  app: "contracts",
  event: "contract.submitted",
  facts: facts as never,
});
const counts = async () =>
  (
    await o<
      { n: number }[]
    >`select ((select count(*) from hub.process_runs) + (select count(*) from hub.review_tasks)
      + (select count(*) from hub.flow_events))::int as n`
  )[0]?.n;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T0] = (await tenants(o, 2, 1279)) as [string, string];
  [U1, U2, U3] = (await users(o, T, 3, { from: 1279 })) as [string, string, string];
  await department(o, T, "pb-kd", { head: U2, members: [U2] });
  await department(o, T, "pb-gd", { head: U3, members: [U3] });
  const st = JSON.stringify(STAGES);
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'cr127-outline', 'Duyet hop dong', ${st}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true)
    returning id::text as id`;
  const lib = r?.id as string;
  await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${lib}, 1, 'Duyet hop dong', ${st}::text::jsonb)`;
  await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T}, ${lib}, true)`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 M4 · outline", () => {
  const eng = () => flowEngineOf({ db } as never).availability;

  it("giá trị > ngưỡng ⇒ nhánh Đúng: có bước Giám đốc; tên người duyệt + hạn chuyển cấp; bước ký số", async () => {
    const before = await counts();
    const out = await eng().outline?.(q(T, { total_value: 800_000_000 }), { starterId: U1 });
    expect(out?.flowName).toBe("Duyet hop dong");
    expect(out?.steps.map((s) => [s.kind, s.label])).toEqual([
      ["review", "Truong phong KD duyet"],
      ["review", "Giam doc duyet"],
      ["esign", "Ky so"],
    ]);
    expect(out?.steps[0]?.whoLabel).not.toBe("Chưa chọn người duyệt");
    expect(out?.steps[1]).toMatchObject({ dueH: 24 });
    expect(out?.steps[2]?.whoLabel).toBe("Các bên ký");
    expect(await counts()).toBe(before); // chỉ đọc
  });

  it("giá trị thấp ⇒ nhánh Sai: bỏ bước Giám đốc; cùng chọn quy trình với hasFlowFor", async () => {
    const out = await eng().outline?.(q(T, { total_value: 100_000_000 }), { starterId: U1 });
    expect(out?.steps.map((s) => s.label)).toEqual(["Truong phong KD duyet", "Ky so"]);
    expect(await eng().hasFlowFor(null, q(T, { total_value: 100_000_000 }))).toBe(true);
  });

  it("công ty không có quy trình đang bật ⇒ null (và hasFlowFor=false); không lộ quy trình công ty khác", async () => {
    expect(
      await eng().outline?.(q(T0, { total_value: 800_000_000 }), { starterId: U1 }),
    ).toBeNull();
    expect(await eng().hasFlowFor(null, q(T0, {}))).toBe(false);
  });
});

// CR-160 · xem trước phải đi đúng nhánh `starter_is_top` (dữ kiện LÕI, engine tự đọc lúc chạy): người gửi là trưởng phòng GỐC ⇒ bỏ bước duyệt.
describe("CR-160 · outline · starter_is_top", () => {
  const eng = () => flowEngineOf({ db } as never).availability;
  const TOP_STAGES = [
    stage(
      "top",
      "Gui la cap cao nhat?",
      0,
      {
        kind: "if",
        when: {
          op: "and",
          conds: [{ from: { kind: "fact", key: "starter_is_top" }, op: "eq", value: true }],
        },
        then_step: 2,
        else_step: 1,
      },
      { kind: "auto", branch: [] },
    ),
    stage("tp", "Truong phong duyet", 1, APPROVE, review("pb-kd3")),
    stage(
      "ky",
      "Ky so",
      2,
      { kind: "tool", tool_key: "contracts-esign", args: {} },
      { kind: "auto", branch: [] },
      { node: "contracts.esign" },
    ),
    stage("xong", "Xong", 3, { kind: "notify" }, { kind: "auto" }, { outcome: "approved" }),
  ];
  let T3 = "";
  let boss = "";
  let staff = "";
  beforeAll(async () => {
    [T3] = (await tenants(o, 1, 1291)) as [string];
    [boss, staff] = (await users(o, T3, 2, { from: 1291 })) as [string, string];
    await department(o, T3, "pb-kd3", { head: boss, members: [boss, staff] });
    const st = JSON.stringify(TOP_STAGES);
    const [r] = await o<
      { id: string }[]
    >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
      values (null, 'cr160-outline', 'Duyet gui di', ${st}::text::jsonb, '{"event":"contract.submitted"}'::jsonb, 'contracts', 1, true)
      returning id::text as id`;
    await o`insert into hub.process_def_releases (def_id, rel_version, name, stages) values (${r?.id as string}, 1, 'Duyet gui di', ${st}::text::jsonb)`;
    await o`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${T3}, ${r?.id as string}, true)`;
  }, 60_000);

  it("người gửi là trưởng phòng gốc ⇒ bỏ bước «Trưởng phòng duyệt»", async () => {
    const out = await eng().outline?.(q(T3, { total_value: 211 }), { starterId: boss });
    expect(out?.steps.map((s) => s.label)).toEqual(["Ky so"]);
  });

  it("người gửi thường ⇒ vẫn có bước duyệt, nói rõ ai (tên trưởng phòng)", async () => {
    const out = await eng().outline?.(q(T3, { total_value: 211 }), { starterId: staff });
    expect(out?.steps.map((s) => s.label)).toEqual(["Truong phong duyet", "Ky so"]);
    expect(out?.steps[0]?.whoLabel).not.toBe("Chưa chọn người duyệt");
  });
});
