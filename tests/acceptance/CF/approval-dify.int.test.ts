// cf-dify · bước Dify trong luồng duyệt HĐ (hub THẬT + Dify GIẢ, KHÔNG gọi Dify thật): `GET /dify-workflows` (admin gói, scope
// tenant, chỉ workflow có công tắc tenant), chạy (quy trình thư viện gán cho tenant, CR-105 L4): Đạt bước 0 ⇒ stage tool gọi Dify với dữ liệu HĐ ⇒ tự sang bước kế
// (review sau Dify mở). Chưa chạy trong lát (e2e/int chạy một lần cuối đợt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { encryptSecret, parseMasterKey } from "../../../apps/admin-api/src/lib/secret-crypto";
import {
  APPROVAL_SLOT,
  compileSlotStages,
} from "../../../apps/hub-api/src/modules/packs/contracts/domain/approval-slot.rules";
import { TEST_MASTER_KEY_B64 } from "../H2a/_h2a";
import { groupId, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitStatus } from "../P-d/_support/pd";
import { type FakeDify, startFakeDify } from "../P-d/d2/_d2";
import { type CtxCf, caller, startCf } from "./_cf";

let c: CtxCf;
let dify: FakeDify;
const WFID = "a5d20000-0000-4000-8000-00000000cf01";
const KEY = "cf-phan-tich";
const BAD = "cf-can-file";
const BADID = "a5d20000-0000-4000-8000-00000000cf02";

beforeAll(async () => {
  dify = startFakeDify();
  c = await startCf({ secretMasterKey: TEST_MASTER_KEY_B64, difyTimeoutMaxS: 300 });
  const key = parseMasterKey(TEST_MASTER_KEY_B64);
  const good = [
    { name: "contract_id", type: "text", required: true, description: "Tham số thử" },
    { name: "title", type: "text", required: false, description: "Tham số thử" },
    { name: "total_value", type: "number", required: false, description: "Tham số thử" },
    { name: "khac", type: "text", required: false, description: "Tham số thử" },
  ];
  const bad = [{ name: "tong_tien", type: "number", required: true, description: "Tham số thử" }];
  for (const [i, w] of [
    { id: WFID, key: KEY, schema: good },
    { id: BADID, key: BAD, schema: bad },
  ].entries()) {
    const sid = `a5d20000-0000-4000-8000-00000000cf1${i}`;
    const s = encryptSecret(key, sid, `app-${w.key}`);
    await c.sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4) values
      (${sid}, ${`CF_SECRET_${i}`}, ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.iv)}, 1, 'key1')
      on conflict do nothing`;
    await c.sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id,
        input_schema, output_field, enabled, side_effect) values
      (${w.id}, ${w.key}, ${`Phân tích ${w.key}`}, 'cf-dify: workflow giả cho int bước Dify', 'workflow', ${dify.baseUrl}, ${sid},
       ${c.sql.json(w.schema as never)}, 'result', true, false) on conflict (id) do nothing`;
  }
}, 180_000);
afterAll(async () => {
  await dify?.stop();
  await c?.stop();
});

const sw = (id: string, on: boolean) =>
  c.sql`insert into admin.tenant_workflow_tools (workflow_id, tenant_id, granted_at, revoked_at)
    values (${id}, ${T.acme}, now(), ${on ? null : new Date()})
    on conflict (workflow_id, tenant_id) do update set revoked_at = ${on ? null : new Date()}`;

const review = (key: string, group: string): Json => ({
  kind: "review",
  key,
  name: key,
  department_group_id: group,
  head_only: false,
  due_h: 48,
  remind_every_h: null,
  escalate_group_id: null,
  exclude_starter: false,
  when: null,
});
const difyStep = (key: string, wf: string): Json => ({
  kind: "dify",
  key,
  name: "Phân tích",
  workflow_key: wf,
  after: "auto",
});

/** CR-105 L4 · quy trình thư viện [duyệt s0 → Dify → duyệt s2] (phòng theo MÃ) gán cho tenant acme (thay cho PUT approval-flow cũ). */
async function assignDifyFlow(): Promise<void> {
  const keyOf = async (role: "editor" | "owner") => {
    const id = await groupId(c, role);
    const [g] = await c.sql<{ key: string }[]>`select key from admin.groups where id = ${id}`;
    return g?.key as string;
  };
  const [kE, kO] = [await keyOf("editor"), await keyOf("owner")];
  const rv = (key: string, dept: string): Json => ({
    ...review(key, ""),
    department_group_id: null,
    department_group_key: dept,
  });
  const body = { steps: [rv("s0", kE), difyStep("d", KEY), rv("s2", kO)] };
  // stages thư viện: chỉ để lưu (lúc mở lượt gói biên dịch lại từ slot_body + catalog Dify của tenant) ⇒ bản không có bước Dify.
  const stages = compileSlotStages({ steps: [rv("s0", kE), rv("s2", kO)] });
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, slot, slot_body,
      published_version) values (null, 'cf-dify-flow', 'Quy trình có bước Dify', ${JSON.stringify(stages)}::text::jsonb,
      ${APPROVAL_SLOT}, ${JSON.stringify(body)}::text::jsonb, 1) returning id::text as id`;
  const id = d?.id as string;
  await c.sql`insert into hub.process_def_releases (def_id, rel_version, name, stages, slot_body)
    values (${id}, 1, 'Quy trình có bước Dify', ${JSON.stringify(stages)}::text::jsonb, ${JSON.stringify(body)}::text::jsonb)`;
  await c.sql`insert into hub.process_slot_assignments (tenant_id, slot, def_id) values (${T.acme}, ${APPROVAL_SLOT}, ${id})
    on conflict (tenant_id, slot) do update set def_id = excluded.def_id`;
}

describe("cf-dify · bước Dify", () => {
  it("GET /dify-workflows: owner thấy workflow đã bật cho tenant; editor 403; chưa bật ⇒ rỗng", async () => {
    const none = await c.call("A", "GET", `/pack/contracts/dify-workflows`);
    expect({ s: none.status, items: (none.json as Json).items }).toEqual({ s: 200, items: [] });
    await sw(WFID, true);
    await sw(BADID, true);
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    const ok = await c.call("A", "GET", `/pack/contracts/dify-workflows`);
    const keys = ((ok.json as Json).items as { key: string }[]).map((i) => i.key).sort();
    expect({ s: ok.status, keys }).toEqual({ s: 200, keys: [BAD, KEY].sort() });
    // Editor thuần (B không thuộc nhóm owner) không có quyền admin gói.
    expect((await c.call("B", "GET", `/pack/contracts/dify-workflows`)).status).toBe(403);
  }, 60_000);

  // CR-105 L4: bỏ test "PUT approval-flow kiểm khoá workflow" — PUT đã xoá; kiểm khoá Dify khi xuất bản thuộc thư viện (L2a).

  it("chạy: Đạt bước 0 ⇒ Dify được gọi với dữ liệu HĐ ⇒ tự sang bước kế (review mở)", async () => {
    await assignDifyFlow();
    dify.script([{ kind: "json", result: { ket_qua: "ok" } }]);
    const id = await seedContract(c, 731);
    const aid = (await toLevel1(c, id, 10_000_000)).runId;
    const [a] = await c.sql<Json[]>`select engine_run_id::text as run, mode from contracts.approvals
      where id = ${aid}`;
    expect(a?.mode).toBe("engine");
    const run = a?.run as string;
    await waitStatus(c.sql, run, "waiting_review");
    expect(await c.port.act(caller(PA.B), run, { stage: "s0" }, { result: "pass" })).toBe("ok");
    await dify.arrived(1, async () => {
      await waitStatus(c.sql, run, "needs_decision");
    });
    expect(dify.calls[0]?.inputs).toMatchObject({ contract_id: id });
    await waitStatus(c.sql, run, "waiting_review");
    const view = await c.port.stepsView(caller(PA.H), run);
    expect(view?.steps.find((s) => s.key === "s2")?.status).toBe("open");
  }, 90_000);
});
