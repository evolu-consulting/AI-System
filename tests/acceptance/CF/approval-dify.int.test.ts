// cf-dify · bước Dify trong luồng duyệt HĐ (hub THẬT + Dify GIẢ, KHÔNG gọi Dify thật): `GET /dify-workflows` (admin gói, scope
// tenant, chỉ workflow có công tắc tenant), `PUT /approval-flow` kiểm khoá workflow (422 DIFY_WORKFLOW_UNKNOWN /
// DIFY_PARAM_UNSUPPORTED theo `steps.i.workflow_key`), chạy: Đạt bước 0 ⇒ stage tool gọi Dify với dữ liệu HĐ ⇒ tự sang bước kế
// (review sau Dify mở). Chưa chạy trong lát (e2e/int chạy một lần cuối đợt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { encryptSecret, parseMasterKey } from "../../../apps/admin-api/src/lib/secret-crypto";
import { TEST_MASTER_KEY_B64 } from "../H2a/_h2a";
import { CBASE, groupId, seedContract, toLevel1 } from "../HD3/_hd3";
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
    { name: "contract_id", type: "text", required: true },
    { name: "title", type: "text", required: false },
    { name: "total_value", type: "number", required: false },
    { name: "khac", type: "text", required: false },
  ];
  const bad = [{ name: "tong_tien", type: "number", required: true }];
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
      (${w.id}, ${w.key}, ${`Phân tích ${w.key}`}, 'cf-dify', 'workflow', ${dify.baseUrl}, ${sid},
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

describe("cf-dify · bước Dify", () => {
  it("GET /dify-workflows: owner thấy workflow đã bật cho tenant; editor 403; chưa bật ⇒ rỗng", async () => {
    const none = await c.call("A", "GET", `${CBASE}/dify-workflows`);
    expect({ s: none.status, items: (none.json as Json).items }).toEqual({ s: 200, items: [] });
    await sw(WFID, true);
    await sw(BADID, true);
    await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    const ok = await c.call("A", "GET", `${CBASE}/dify-workflows`);
    const keys = ((ok.json as Json).items as { key: string }[]).map((i) => i.key).sort();
    expect({ s: ok.status, keys }).toEqual({ s: 200, keys: [BAD, KEY].sort() });
    // Editor thuần (B không thuộc nhóm owner) không có quyền admin gói.
    expect((await c.call("B", "GET", `${CBASE}/dify-workflows`)).status).toBe(403);
  }, 60_000);

  it("PUT approval-flow: khoá lạ ⇒ 422 DIFY_WORKFLOW_UNKNOWN; tham số bắt buộc không thoả ⇒ DIFY_PARAM_UNSUPPORTED; hợp lệ ⇒ 200", async () => {
    const gE = await groupId(c, "editor");
    const gO = await groupId(c, "owner");
    const put = async (steps: Json[], version = 1) =>
      c.call("A", "PUT", `${CBASE}/approval-flow`, { version, steps });
    const unk = await put([review("s0", gE), difyStep("d", "khong-co"), review("s2", gO)]);
    expect({ s: unk.status, i: (unk.json as Json).error?.details?.issues }).toEqual({
      s: 422,
      i: [{ path: "steps.1.workflow_key", rule: "DIFY_WORKFLOW_UNKNOWN" }],
    });
    const prm = await put([review("s0", gE), difyStep("d", BAD), review("s2", gO)]);
    expect((prm.json as Json).error?.details?.issues).toEqual([
      { path: "steps.1.workflow_key", rule: "DIFY_PARAM_UNSUPPORTED" },
    ]);
    const ok = await put([review("s0", gE), difyStep("d", KEY), review("s2", gO)]);
    expect({ s: ok.status, v: (ok.json as Json).version }).toEqual({ s: 200, v: 2 });
  }, 60_000);

  it("chạy: Đạt bước 0 ⇒ Dify được gọi với dữ liệu HĐ ⇒ tự sang bước kế (review mở)", async () => {
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
      await waitStatus(c.sql, run, "failed");
    });
    expect(dify.calls[0]?.inputs).toMatchObject({ contract_id: id });
    await waitStatus(c.sql, run, "waiting_review");
    const view = await c.port.stepsView(caller(PA.H), run);
    expect(view?.steps.find((s) => s.key === "s2")?.status).toBe("open");
  }, 90_000);
});
