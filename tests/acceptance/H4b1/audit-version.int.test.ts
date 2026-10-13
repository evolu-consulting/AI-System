// HUB-FR-69 · HUB-FR-68 · AC-H4b1-01 (audit), AC-H4b1-03, AC-H4b1-04 · spec §3 Audit · plan D8 · test-plan H4b1 §3
// A60–A66: mỗi ghi = 1 hàng `hub.audit_log` (entity secret, action create|rotate|delete, entity_name `<kind>:<name>`,
// before/after chỉ {name, kind, tenant_id, version}, summary {kind}) + `hub_config_version` +1 (= audit) + NOTIFY
// `hub_config_changed`; lỗi ⇒ 0 ghi, không NOTIFY; audit ném ⇒ rollback toàn bộ. Đỏ trước code: route chưa có ⇒ 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { listenHub, type Notes } from "../H3b/_h3b";
import {
  auditMax,
  auditSince,
  type Ctx,
  create,
  errOf,
  expectNoValue,
  extraHub,
  failingAudit,
  HUB_KEY,
  idOf,
  NONE,
  secretRow,
  startH4b1,
  stateOf,
  studio,
  T,
  USERS,
  val,
  versionOf,
} from "./_h4b1";

let x: Ctx;
let n: Notes;
beforeAll(async () => {
  x = await startH4b1();
  n = await listenHub();
}, 60_000);
afterAll(async () => {
  await n?.close();
  await x?.stop();
});

const snap = (name: string, kind: string, tenant: string | null, version: number) => ({
  name,
  kind,
  tenant_id: tenant,
  version,
});

describe("A60–A62 · audit từng thao tác [HUB-FR-69 · spec §3 Audit]", () => {
  it("HUB-FR-69 · AC-H4b1-01 · A60 · create ⇒ 1 audit {secret, create, tenant null, entity_name provider_api_key:anthropic-main, before null, after snapshot v1, summary {kind}}; version +1 = audit; NOTIFY", async () => {
    const v = val("a60");
    const m = await auditMax(x.sql);
    const v0 = await versionOf(x.sql);
    const mark = n.mark();
    const r = await create(x, { kind: "provider_api_key", name: "anthropic-main", value: v });
    expect(r.status).toBe(201);
    const rows = await auditSince(x.sql, m);
    expect(rows.length).toBe(1);
    const a = rows[0];
    expect({
      entity: a?.entity,
      action: a?.action,
      entity_id: a?.entity_id,
      tenant_id: a?.tenant_id,
      entity_name: a?.entity_name,
      before: a?.before,
      after: a?.after,
      summary: a?.summary,
      actor: [a?.actor_id, a?.actor_role],
    }).toEqual({
      entity: "secret",
      action: "create",
      entity_id: idOf(r),
      tenant_id: null,
      entity_name: "provider_api_key:anthropic-main",
      before: null,
      after: snap("anthropic-main", "provider_api_key", null, 1),
      summary: { kind: "provider_api_key" },
      actor: [USERS.padmin.id, "platform_admin"],
    });
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    expect(a?.hub_config_version).toBe(v0 + 1);
    expectNoValue(JSON.stringify(rows), [v]);
    await n.sentinel();
    expect(n.since(mark).length).toBe(1);
  });
  it("HUB-FR-69 · AC-H4b1-03 · A61 · rotate ⇒ audit action `rotate`, before v1 → after v2 (không giá trị); version +1", async () => {
    const c = await create(x, {
      kind: "kh_api_key",
      name: "kh-acme",
      value: val("a61"),
      tenant_id: T.acme,
    });
    expect(c.status).toBe(201);
    const m = await auditMax(x.sql);
    const v0 = await versionOf(x.sql);
    const r = await studio(x, "padmin", "PUT", `/${idOf(c)}`, {
      version: 1,
      value: val("a61-moi"),
    });
    expect(r.status).toBe(200);
    const rows = await auditSince(x.sql, m);
    expect(rows.map((a) => [a.action, a.tenant_id, a.entity_name, a.before, a.after])).toEqual([
      [
        "rotate",
        T.acme,
        "kh_api_key:kh-acme",
        snap("kh-acme", "kh_api_key", T.acme, 1),
        snap("kh-acme", "kh_api_key", T.acme, 2),
      ],
    ]);
    expect(await versionOf(x.sql)).toBe(v0 + 1);
    expectNoValue(JSON.stringify(rows), [val("a61"), val("a61-moi")]);
  });
  it("HUB-FR-69 · AC-H4b1-04 · A62 · delete ⇒ 204 + audit `delete` (before snapshot, after null), tenant của secret; version +1", async () => {
    const c = await create(x, {
      kind: "source_credential",
      name: "git-beta",
      value: val("a62"),
      tenant_id: T.beta,
    });
    expect(c.status).toBe(201);
    const m = await auditMax(x.sql);
    const v0 = await versionOf(x.sql);
    expect((await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`)).status).toBe(204);
    const rows = await auditSince(x.sql, m);
    expect(rows.map((a) => [a.action, a.entity_id, a.tenant_id, a.before, a.after])).toEqual([
      ["delete", idOf(c), T.beta, snap("git-beta", "source_credential", T.beta, 1), null],
    ]);
    expect(await versionOf(x.sql)).toBe(v0 + 1);
  });
});

describe("A63–A64 · lỗi ⇒ 0 ghi, không NOTIFY [HUB-FR-69]", () => {
  it("HUB-FR-69 · A63 · 400 / 409 NAME_TAKEN / 409 VERSION_CONFLICT / 404 ⇒ secrets + version + audit nguyên, không NOTIFY", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a63", value: val("a63") });
    expect(c.status).toBe(201);
    const s0 = await stateOf(x.sql);
    const mark = n.mark();
    const codes = [
      errOf(await create(x, { kind: "provider_api_key", name: "x", value: val("a63") })).code,
      errOf(await create(x, { kind: "provider_api_key", name: "QC-A63", value: val("a63") })).code,
      errOf(await studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 9, value: val("a63") }))
        .code,
      errOf(await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=9`)).code,
      errOf(await studio(x, "padmin", "PUT", `/${NONE}`, { version: 1, value: val("a63") })).code,
    ];
    expect(codes).toEqual([
      "VALIDATION_ERROR",
      "SECRET_NAME_TAKEN",
      "VERSION_CONFLICT",
      "VERSION_CONFLICT",
      "NOT_FOUND",
    ]);
    await n.sentinel();
    expect(n.since(mark)).toEqual([]);
    expect(await stateOf(x.sql)).toEqual(s0);
  });
  it("HUB-FR-69 · A64 · GET list / GET id không ghi audit, không đổi version", async () => {
    const s0 = await stateOf(x.sql);
    const l = await studio(x, "padmin", "GET");
    expect(l.status).toBe(200);
    expect(await stateOf(x.sql)).toEqual(s0);
  });
});

describe("A65–A66 · audit ném ⇒ rollback [spec §3 Audit · plan D8]", () => {
  it("HUB-FR-69 · A65 · hubAudit ném ở create / rotate / delete ⇒ 5xx, không hàng mới, giá trị/version secret nguyên, hub_config_version nguyên", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a65", value: val("a65") });
    expect(c.status).toBe(201);
    const before = await secretRow(x.sql, idOf(c));
    const audit = failingAudit(["create", "rotate", "delete"]);
    const hub = await extraHub(x, { hubSecretsKey: HUB_KEY, hubAudit: audit });
    try {
      const s0 = await stateOf(x.sql);
      const st = [
        (
          await studio(
            x,
            "padmin",
            "POST",
            "",
            { kind: "provider_api_key", name: "qc-a65b", value: val("a65b") },
            hub,
          )
        ).status,
        (await studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a65c") }, hub))
          .status,
        (await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`, undefined, hub)).status,
      ];
      expect(st.map((s) => s >= 500)).toEqual([true, true, true]);
      expect(audit.calls).toEqual(["create", "rotate", "delete"]);
      expect(await stateOf(x.sql)).toEqual(s0);
      expect(await secretRow(x.sql, idOf(c))).toEqual(before);
    } finally {
      await hub.stop();
    }
  });
  it("HUB-FR-69 · A66 · ba ghi liên tiếp ⇒ hub_config_version tăng đúng 3, audit seq tăng đúng 3, mỗi audit mang version tương ứng", async () => {
    const m = await auditMax(x.sql);
    const v0 = await versionOf(x.sql);
    const c = await create(x, { kind: "provider_api_key", name: "qc-a66", value: val("a66") });
    await studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a66b") });
    await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=2`);
    const rows = await auditSince(x.sql, m);
    expect(rows.map((a) => a.hub_config_version)).toEqual([v0 + 1, v0 + 2, v0 + 3]);
    expect(await versionOf(x.sql)).toBe(v0 + 3);
  });
});
