// CR-140 · node «Ghi thanh toán vào HĐ», DB thật (pool hub_api, role contracts_rw; cây lượt + liên kết lượt↔HĐ thật trong hub): bước chi tiền xong
// mà HĐ không có đợt thanh toán ⇒ MỘT dòng «đã trả» trong sổ thanh toán của HĐ (`contracts.obligations`) + sổ đối tác + nhật ký. Người ghi = thủ quỹ
// (khác người tạo HĐ / bắt đầu lượt). Thử lại / hai lời gọi song song cùng lượt ⇒ một dòng. Chặn: HĐ khác cùng công ty, công ty khác, gọi ngoài
// node, vượt giá trị HĐ, ngày sai; HĐ có đợt đang mở thì không ghi thêm.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { packRecordPort } from "../processes/public";
import { recordPaymentRepo } from "./contracts/adapters/record-payment.repo";
import { recordPaymentTool } from "./contracts/adapters/record-payment.tool";
import { createPackUow } from "./kit/adapters/pack-uow";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = ""; // người tạo HĐ + bắt đầu lượt
let B = ""; // thủ quỹ (người xác nhận «Đã chi»)
let X = "";
let C1 = "";
let C2 = "";
let DEF = "";
const NODE = "contracts.record-payment";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 1401)) as [string, string];
  [A, B] = (await users(o, T1, 2, { from: 1401 })) as [string, string];
  [X] = (await users(o, T2, 1, { from: 1411 })) as [string];
  [C1, C2] = (await contracts(o, T1, 2, { createdBy: A, owner: A, from: 1401 })) as [
    string,
    string,
  ];
  await o`update contracts.contracts set fields = jsonb_build_object(
      'supplier_name', jsonb_build_object('value', 'Công ty Cung Ứng'),
      'total_value', jsonb_build_object('value', '7000000'))
    where tenant_id = ${T1} and id in (${C1}, ${C2})`;
  const [d] = await o<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, sources, inputs, slot, slot_body, published_version)
    select null, 'rp-int', 'Quy trình mồi', description, input_hint, run_group_ids, stages, token_budget, enabled,
      sources, inputs, slot, slot_body, 1
    from hub.process_defs where tenant_id is null and deleted_at is null limit 1 returning id::text as id`;
  DEF = d?.id as string;
  db = createDb(urls().hubApi, { max: 8 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

type RunOpts = {
  record?: string | null;
  node?: boolean;
  actor?: string | null;
  parent?: { run: string; stage: string };
  /** lượt con thứ mấy của cùng bước cha (khoá duy nhất `parent_stage_run_id, attempt, round`) */
  round?: number;
};
/** Một lượt thật của hub (+ hội thoại), tuỳ chọn: gắn HĐ, có bước node «Ghi thanh toán», người đã hoàn tất bước trước, lượt cha. */
async function mkRun(tenant: string, user: string, x: RunOpts = {}) {
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${tenant}, ${user}, 'c', 'c') returning id::text as id`;
  const snapshot = { stages: x.node === false ? [{ node: "core.notify" }] : [{ node: NODE }] };
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, expires_at, pack_key, pack_record_id, parent_run_id, parent_stage_run_id, parent_attempt, parent_round)
    values (${tenant}, ${DEF}, 1, ${o.json(snapshot)}, ${user}, 'admin', 'x', ${c?.id as string}, gen_random_uuid(),
      now() + interval '1 day', ${x.record ? "contracts" : null}, ${x.record ?? null}, ${x.parent?.run ?? null},
      ${x.parent?.stage ?? null}, ${x.parent ? 1 : null}, ${x.parent ? (x.round ?? 1) : null}) returning id::text as id`;
  const id = r?.id as string;
  const [s] = await o<
    { id: string }[]
  >`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status, passed_by, passed_at)
    values (${tenant}, ${id}, 0, 'done', ${x.actor ?? null}, ${x.actor ? new Date().toISOString() : null})
    returning id::text as id`;
  return { run: id, stage: s?.id as string };
}
/** Cây như quy trình mua hàng: cha → B (tạo HĐ, gắn HĐ) và C (thanh toán, có node ghi sổ; thủ quỹ đã xong bước 11). */
async function mkTree(
  record: string | null,
  x: { node?: boolean; tenant?: string; user?: string } = {},
) {
  const tenant = x.tenant ?? T1;
  const user = x.user ?? A;
  const p = await mkRun(tenant, user, { node: false });
  const parent = { run: p.run, stage: p.stage };
  if (record) await mkRun(tenant, user, { record, parent, node: false, round: 1 });
  const c = await mkRun(tenant, user, {
    parent,
    round: 2,
    node: x.node ?? true,
    actor: x.user ?? B,
  });
  return c.run;
}

const tool = () =>
  recordPaymentTool({
    uow: createPackUow(db, "contracts", recordPaymentRepo),
    stepContext: (t, r) => packRecordPort({ db } as never).stepContext(t, r, "contracts", NODE),
  });
const ctx = (tenantId: string, userId: string, processRunId: string | null) => ({
  tenantId,
  userId,
  runId: null,
  processRunId,
});
const rows = async (t: string, c: string) => [
  ...(await o`select kind, direction, status, amount::text as amount, done_at::text as done_at, done_by::text as by,
      source, party_key from contracts.obligations where tenant_id = ${t} and contract_id = ${c} order by seq`),
];
const PAID = "2026-11-05";

describe("contracts-record-payment", () => {
  it("HĐ không có đợt: ghi một dòng «đã trả» do thủ quỹ; thử lại / song song không trùng; vượt giá trị HĐ bị chặn; HĐ có đợt mở thì không ghi thêm", async () => {
    const run = await mkTree(C1);
    // người bắt đầu lượt (A) gọi — người ghi vẫn là thủ quỹ (B), không phải A
    const r = await tool().run(ctx(T1, A, run), {
      contract_id: C1,
      amount: 5_000_000,
      paid_at: PAID,
    });
    expect(r).toMatchObject({ status: "recorded", contract_id: C1 });
    expect(await rows(T1, C1)).toEqual([
      {
        kind: "payment",
        direction: "pay",
        status: "done",
        amount: "5000000",
        done_at: PAID,
        by: B,
        source: "fulfill",
        party_key: expect.stringMatching(/^name:/),
      },
    ]);
    const [ev] =
      await o`select count(*)::int as n, max(amount)::text as amount, max(by_user::text) as by
      from contracts.partner_events where tenant_id = ${T1} and contract_id = ${C1} and type = 'paid'`;
    expect(ev).toEqual({ n: 1, amount: "5000000", by: B });

    // engine thử lại cùng lượt ⇒ không ghi trùng
    const again = await tool().run(ctx(T1, A, run), { amount: 5_000_000, paid_at: PAID });
    expect(again).toMatchObject({ status: "exists" });
    expect((await rows(T1, C1)).length).toBe(1);

    // hai lời gọi SONG SONG của cùng một lượt ⇒ đúng một dòng mới
    const run2 = await mkTree(C1);
    const two = await Promise.all([
      tool().run(ctx(T1, A, run2), { amount: 1_000_000, paid_at: PAID }),
      tool().run(ctx(T1, A, run2), { amount: 1_000_000, paid_at: PAID }),
    ]);
    expect(two.map((x) => x.status).sort()).toEqual(["exists", "recorded"]);
    expect((await rows(T1, C1)).map((x) => x.amount)).toEqual(["5000000", "1000000"]);

    // tổng đã trả (6 triệu) + 2 triệu > giá trị HĐ 7 triệu ⇒ chặn; không số tiền ⇒ lấy giá trị HĐ (7 triệu) cũng vượt
    for (const args of [{ amount: 2_000_000 }, { amount: "" }])
      await expect(
        tool().run(ctx(T1, A, await mkTree(C1)), { ...args, paid_at: PAID }),
      ).rejects.toThrow("CONTRACT_PAYMENT_BAD_AMOUNT");
    expect((await rows(T1, C1)).length).toBe(2);

    // HĐ có đợt thanh toán đang mở ⇒ để «Xác nhận mốc» lo, không ghi thêm
    await o`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq, due_date, amount, title)
      values (${T1}, ${C2}, 'pay', 'payment', 1, '2026-11-10', 1000, 'Đợt 1')`;
    const sch = await tool().run(ctx(T1, A, await mkTree(C2)), { amount: 1000, paid_at: PAID });
    expect(sch).toMatchObject({ status: "has_schedule" });
    expect((await rows(T1, C2)).map((x) => x.status)).toEqual(["open"]);
  });

  it("chặn: HĐ khác cùng công ty, công ty khác, gọi ngoài node, ngày sai; lượt không có HĐ thì bỏ qua", async () => {
    const c2Before = (await rows(T1, C2)).length;
    const c1Before = (await rows(T1, C1)).length;
    // args chỉ HĐ khác HĐ gắn lượt (cùng công ty) ⇒ từ chối
    await expect(
      tool().run(ctx(T1, A, await mkTree(C1)), { contract_id: C2, amount: 1, paid_at: PAID }),
    ).rejects.toThrow("CONTRACT_PAYMENT_NO_CONTRACT");
    // lượt không gắn HĐ mà args chỉ HĐ ⇒ từ chối (không tin args)
    await expect(
      tool().run(ctx(T1, A, await mkTree(null)), { contract_id: C1, amount: 1, paid_at: PAID }),
    ).rejects.toThrow("CONTRACT_PAYMENT_NO_CONTRACT");
    // lượt thật không có HĐ (đơn mua nhỏ) + args trống ⇒ bỏ qua
    expect(await tool().run(ctx(T1, A, await mkTree(null)), { paid_at: PAID })).toEqual({
      status: "skipped",
    });
    // lượt công ty khác có liên kết HĐ của công ty này (giả mạo) ⇒ không thấy HĐ ⇒ từ chối, không ghi gì
    await expect(
      tool().run(ctx(T2, X, await mkTree(C1, { tenant: T2, user: X })), {
        amount: 1,
        paid_at: PAID,
      }),
    ).rejects.toThrow("CONTRACT_PAYMENT_NO_CONTRACT");
    // gọi ngoài node / không có lượt
    await expect(
      tool().run(ctx(T1, A, await mkTree(C1, { node: false })), { amount: 1, paid_at: PAID }),
    ).rejects.toThrow("CONTRACT_PAYMENT_NOT_IN_STAGE");
    await expect(tool().run(ctx(T1, A, null), { amount: 1, paid_at: PAID })).rejects.toThrow(
      "CONTRACT_PAYMENT_NO_RUN",
    );
    // ngày trống / sai ⇒ lỗi (không âm thầm lấy hôm nay)
    await expect(
      tool().run(ctx(T1, A, await mkTree(C1)), { amount: 1, paid_at: "" }),
    ).rejects.toThrow("CONTRACT_PAYMENT_BAD_DATE");
    expect((await rows(T1, C2)).length).toBe(c2Before);
    expect((await rows(T1, C1)).length).toBe(c1Before);
    expect(
      (await o`select count(*)::int as n from contracts.obligations where tenant_id = ${T2}`)[0]?.n,
    ).toBe(0);
  });
});
