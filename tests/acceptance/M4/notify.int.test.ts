// ADM-FR-40, ADM-FR-52, ADM-FR-53 · Q9 · Q2b · NOTIFY `config_changed` của quota/restore/evaluator (test-plan N1–N3).
// Listener LISTEN riêng (vai Hub) + sentinel, không sleep. Xanh ở T3/T2b/T4.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  auditMark,
  audits,
  createM4Env,
  expectErr4,
  ID,
  insertUsage,
  type Listener,
  type M4Env,
  mailsTo,
  poll,
  putQuota,
  qi,
  resetNow,
  TENANT_ID,
  track,
} from "./_ab";

let env: M4Env;
let lis: Listener;
const A = TENANT_ID.acme;

beforeAll(async () => {
  env = await createM4Env();
  lis = await env.listen();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await resetNow(env);
  await env.admin();
});

describe("ADM-FR-53 · NOTIFY M4", () => {
  it("ADM-FR-40 · Q9 · M4-R10 · N1 · PUT quota → đúng 1 config_changed {v, entity quota, tenant_id acme} strict; v = audit.config_version", async () => {
    const mark = await auditMark(env.owner);
    const t = await track(env, lis, () => putQuota(env, A, [qi(null, { runs: 10 })]));
    expect(t.res.status).toBe(200);
    expect(t.msgs).toHaveLength(1);
    expect(JSON.parse(t.msgs[0]?.raw ?? "{}")).toEqual({ v: t.v1, entity: "quota", tenant_id: A });
    const rows = await audits(env, mark);
    expect(rows.map((r) => r.config_version)).toEqual([t.v1]);
  });

  it("ADM-FR-52 · M4-R13 · N2 · restore → 1 NOTIFY entity gốc; restore lỗi (409) → 0", async () => {
    const cmd = ID.command.dich;
    const v = Number(
      (await env.owner`select version from admin.commands where id = ${cmd}`)[0]?.version,
    );
    const mark = await auditMark(env.owner);
    expect(
      (await env.as("PATCH", `/admin/commands/${cmd}`, { version: v, description: { vi: "N2" } }))
        .status,
    ).toBe(200);
    const [e] = await env.owner<{ id: string }[]>`select id from admin.audit_log
      where seq > ${mark}::bigint and entity = 'command' and entity_id = ${cmd} order by seq desc limit 1`;
    const ok = await track(env, lis, () => env.as("POST", `/admin/audit/${e?.id}/restore`, {}));
    expect(ok.res.status).toBe(200);
    expect(ok.msgs.map((m) => m.payload.entity)).toEqual(["command"]);
    const bad = await track(env, lis, () => env.as("POST", `/admin/audit/${e?.id}/restore`, {}));
    expectErr4(bad.res, "VERSION_CONFLICT");
    expect(bad.msgs).toHaveLength(0);
    expect(bad.v1).toBe(bad.v0);
  });

  it("ADM-FR-41 · Q2b · N3 · evaluator gửi mail → không phát config_changed nào thêm (chỉ 1 của PUT)", async () => {
    await insertUsage(env.owner, 850, { tenant: A });
    const from = lis.msgs.length;
    const v0 = await env.cfg();
    expect((await putQuota(env, A, [qi(null, { runs: 1000 })])).status).toBe(200);
    await poll(
      () => mailsTo(env, "binh@acme.test").length + mailsTo(env, "chi@acme.test").length,
      2,
    );
    const msgs = await env.settle(lis, from);
    expect(msgs.map((m) => m.payload.entity as string)).toEqual(["quota"]);
    expect(await env.cfg()).toBe(v0 + 2);
  });
});
