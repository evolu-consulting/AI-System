// CR-127 · SG1 · BR-67/68 · `POST /contracts/:id/expiry-outcome` (use case) + `can.expiry` / `awaiting_decision` / `return_reason` của chi tiết HĐ. DB thật, role gói + RLS.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { withExpiryCan } from "../application/detail-expiry-role";
import {
  expiryCommands,
  expiryFlowOpen,
  expiryStateOk,
} from "../application/expiry-outcome.usecase";
import { getContract } from "../application/get-contract.usecase";
import { expiryDepsOf } from "../expiry-outcome.mount";
import { contractsRepo } from "./contracts.repo";

let o: Sql;
let db: Db;
let T = "";
let T2 = "";
let OWN = "";
let OTHER = "";
let ADM = "";
let flow = false;
const today = async () => new Date().toISOString().slice(0, 10);
const deps = () => ({
  ...expiryDepsOf(db, { today, isAdmin: async (w) => w.userId === ADM }),
  hasFlow: async () => flow,
});
const cmd = () => expiryCommands(deps());
const who = (userId: string, tenantId = T) => ({ tenantId, userId, admin: userId === ADM });
const EV = { note: "Đã thoả thuận với đối tác" };

const detailUow = () =>
  createPackUow(db, "contracts", (tx, t) => ({ contracts: contractsRepo(tx, t) }));
const detail = (userId: string, id: string, tenantId = T) =>
  withExpiryCan(getContract({ uow: detailUow(), today }), {
    stateOk: expiryStateOk,
    roleOk: deps().roleOk,
    flowOpen: expiryFlowOpen(deps()),
  })({ tenantId, userId }, id);

async function expiring(extra: Record<string, unknown> = {}): Promise<string> {
  const end = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  const [r] = await o<{ id: string }[]>`insert into contracts.contracts ${o({
    tenant_id: T,
    title: "HĐ thử SG1",
    created_by: OWN,
    owner_user_id: OWN,
    status: "done",
    fields: { end_date: { value: end } },
    ...extra,
  } as never)} returning id`;
  const id = (r as { id: string }).id;
  await o`select contracts.refresh_effect(array[${id}]::uuid[], current_date)`;
  return id;
}
const row = async (id: string) =>
  (
    await o<
      { effect: string | null; effect_outcome: string | null }[]
    >`select effect, effect_outcome from contracts.contracts where id = ${id}`
  )[0];
const code = async (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e as { kind?: string }).kind ?? String(e),
  );

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9296)) as [string, string];
  [OWN, OTHER, ADM] = (await users(o, T, 3, { from: 9297 })) as [string, string, string];
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 SG1 · kết cục hiệu lực bằng tay", () => {
  it("người phụ trách: Chấm dứt / Gia hạn / Để hết hạn đều ghi bằng chứng + lịch sử", async () => {
    flow = false;
    const a = await expiring();
    expect((await row(a))?.effect).toBe("expiring");
    expect(await cmd()(who(OWN), a, { outcome: "terminate", evidence: EV })).toEqual({
      state: "applied",
      renewal_id: null,
    });
    expect((await row(a))?.effect_outcome).toBe("terminated");

    const b = await expiring();
    const r = await cmd()(who(OWN), b, { outcome: "renew", evidence: EV });
    expect(r.renewal_id).not.toBeNull();
    const kid =
      await o`select status, renews_id from contracts.contracts where id = ${r.renewal_id}`;
    expect([kid[0]?.status, kid[0]?.renews_id]).toEqual(["draft", b]);

    const c = await expiring();
    expect(await cmd()(who(OWN), c, { outcome: "let_expire", evidence: EV })).toEqual({
      state: "applied",
      renewal_id: null,
    });
    expect((await row(c))?.effect_outcome).toBeNull(); // hiệu lực tự hết hạn theo ngày
    const ev =
      await o`select 1 from contracts.contract_events where contract_id = ${c} and type = 'expiry_let_expire'`;
    expect(ev.length).toBe(1);
  });

  it("quyền: người lạ ⇒ forbidden; quản trị công ty được; thiếu bằng chứng ⇒ EVIDENCE_REQUIRED", async () => {
    flow = false;
    const id = await expiring();
    expect(await code(cmd()(who(OTHER), id, { outcome: "terminate", evidence: EV }))).toBe(
      "forbidden",
    );
    expect(await code(cmd()(who(OWN), id, { outcome: "let_expire" }))).toBe("evidence_required");
    expect(await code(cmd()(who(ADM), id, { outcome: "terminate", evidence: EV }))).toBe("ok");
    expect(await code(cmd()(who(ADM), id, { outcome: "terminate", evidence: EV }))).toBe("decided");
  });

  it("có quy trình khớp ⇒ 409 in_flow + can.expiry=false; trạng thái không phải Sắp hết hạn ⇒ not_allowed; tenant khác ⇒ not_found", async () => {
    const id = await expiring();
    flow = true;
    expect(await code(cmd()(who(OWN), id, { outcome: "terminate", evidence: EV }))).toBe("in_flow");
    expect((await detail(OWN, id))?.can.expiry).toBeFalsy();
    flow = false;
    expect((await detail(OWN, id))?.can.expiry).toBe(true); // người phụ trách
    expect((await detail(ADM, id))?.can.expiry).toBe(true); // quản trị
    expect((await detail(OTHER, id))?.can.expiry).toBeFalsy(); // người lạ
    const draft = await expiring({ status: "draft" });
    expect(await code(cmd()(who(OWN), draft, { outcome: "terminate", evidence: EV }))).toBe(
      "not_allowed",
    );
    expect(await code(cmd()(who(OWN, T2), id, { outcome: "terminate", evidence: EV }))).toBe(
      "not_found",
    );
  });
});

describe("CR-127 SG1 · chi tiết: awaiting_decision + return_reason", () => {
  it("awaiting_decision: true chỉ khi HĐ nhận chờ người phụ trách quyết; HĐ thường false", async () => {
    const id = await expiring({ status: "processing" });
    expect((await detail(OWN, id))?.awaiting_decision).toBe(false);
    await o`insert into contracts.partner_inbox (tenant_id, contract_id, mailbox_id, sender_name, expires_at, awaiting_decision)
      values (${T}, ${id}, gen_random_uuid(), 'Bên gửi', now() + interval '10 days', true)`;
    expect((await detail(OWN, id))?.awaiting_decision).toBe(true);
    await o`update contracts.partner_inbox set awaiting_decision = false where contract_id = ${id}`;
    expect((await detail(OWN, id))?.awaiting_decision).toBe(false);
  });

  it("return_reason: người gửi/người phụ trách/người đã quyết đọc được; người khác null; HĐ không DRAFT null", async () => {
    const id = await expiring({ status: "draft", submitted_by: OTHER });
    await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data)
      values (${T}, ${id}, 'stage_decided', ${ADM}, jsonb_build_object('action', 'return', 'task_id', gen_random_uuid()::text,
        'feedback', 'Thiếu điều khoản phạt'))`;
    expect((await detail(OTHER, id))?.return_reason).toBe("Thiếu điều khoản phạt"); // người gửi
    expect((await detail(OWN, id))?.return_reason).toBe("Thiếu điều khoản phạt"); // người phụ trách
    expect((await detail(ADM, id))?.return_reason).toBe("Thiếu điều khoản phạt"); // người đã quyết
    const [third] = (await users(o, T, 1, { from: 9399 })) as [string];
    expect((await detail(third as string, id))?.return_reason).toBeNull();
    await o.begin(async (t) => {
      await t.unsafe("select set_config('contracts.state_gate', 'bulk:' || txid_current(), true)");
      await t`update contracts.contracts set status = 'processing' where id = ${id}`;
    });
    expect((await detail(OTHER, id))?.return_reason).toBeNull();
  });
});
