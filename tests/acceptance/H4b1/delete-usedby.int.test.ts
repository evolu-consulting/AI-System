// HUB-FR-68 · HUB-FR-69 · AC-H4b1-04 · spec §3 A DELETE + used_by · plan D9, D11 · test-plan H4b1 §3 A22–A28: xoá theo
// version, SECRET_IN_USE kèm used_by (provider / nguồn còn sống cùng tenant), gỡ tham chiếu ⇒ 204, NOT_CONFIGURED khi Hub
// không có khoá. Tách từ studio-crud (≤ 400 dòng). Đỏ trước code: route chưa mount ⇒ 404 ≠ kỳ vọng.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Ctx,
  create,
  errOf,
  extraHub,
  idGen,
  idOf,
  insertProvider,
  insertSourceRef,
  NONE,
  secretRow,
  startH4b1,
  stateOf,
  studio,
  T,
  val,
} from "./_h4b1";

let x: Ctx;
const id = idGen(1000);
beforeAll(async () => {
  x = await startH4b1();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

/** 0 ghi: hàng secrets + version + audit giữ nguyên quanh `f`. */
async function noWrite(f: () => Promise<{ status: number }>, status: number, code: string) {
  const s0 = await stateOf(x.sql);
  const r = (await f()) as never;
  expect(errOf(r)).toMatchObject({ status, code });
  expect(await stateOf(x.sql)).toEqual(s0);
  return r as { json: { error?: { details?: { issues?: { path: unknown }[] } } } };
}
const _paths = (r: { json: { error?: { details?: { issues?: { path: unknown }[] } } } }) =>
  (r.json?.error?.details?.issues ?? []).map((i) =>
    Array.isArray(i.path) ? i.path.join(".") : String(i.path),
  );

describe("A22–A27 · xoá + used_by [AC-H4b1-04 · ui-agent-studio §ràng buộc xoá · D9]", () => {
  it("HUB-FR-68 · AC-H4b1-04 · A22 · DELETE version đúng, không tham chiếu ⇒ 204; hàng mất; GET ⇒ 404", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a22", value: val("a22") });
    const r = await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`);
    expect(r.status).toBe(204);
    expect(await secretRow(x.sql, idOf(c))).toBeUndefined();
    expect((await studio(x, "padmin", "GET", `/${idOf(c)}`)).status).toBe(404);
  });
  it("HUB-FR-69 · A23 · DELETE version sai ⇒ 409 VERSION_CONFLICT; vắng version ⇒ 400; id lạ ⇒ 404 (0 ghi)", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a23", value: val("a23") });
    expect(c.status).toBe(201);
    await noWrite(
      () => studio(x, "padmin", "DELETE", `/${idOf(c)}?version=2`),
      409,
      "VERSION_CONFLICT",
    );
    await noWrite(() => studio(x, "padmin", "DELETE", `/${idOf(c)}`), 400, "VALIDATION_ERROR");
    await noWrite(() => studio(x, "padmin", "DELETE", `/${NONE}?version=1`), 404, "NOT_FOUND");
  });
  it("HUB-FR-68 · AC-H4b1-04 · A24 · provider trỏ tới ⇒ list used_by [{provider}]; DELETE ⇒ 409 SECRET_IN_USE {used_by}; gỡ tham chiếu ⇒ 204", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a24", value: val("a24") });
    expect(c.status).toBe(201);
    const pid = id();
    await insertProvider(x.sql, pid, "qc-a24-api", idOf(c));
    const g = await studio(x, "padmin", "GET", `/${idOf(c)}`);
    expect(g.json?.used_by).toEqual([{ type: "provider", id: pid, key: "qc-a24-api" }]);
    const r = await noWrite(
      () => studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`),
      409,
      "SECRET_IN_USE",
    );
    expect((r.json.error?.details as { used_by?: unknown })?.used_by).toEqual([
      { type: "provider", id: pid, key: "qc-a24-api" },
    ]);
    await x.sql`update hub.providers set secret_id = null where id = ${pid}`;
    expect((await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`)).status).toBe(204);
  });
  it("HUB-FR-68 · CR-060 · AC-H4b1-04 · A25 · nguồn acme `config.credential_secret_id` ⇒ used_by [{source}]; nguồn đã xoá mềm / nguồn tenant khác không tính", async () => {
    const c = await create(x, {
      kind: "source_credential",
      name: "qc-a25",
      value: val("a25"),
      tenant_id: T.acme,
    });
    expect(c.status).toBe(201);
    const live = id();
    await insertSourceRef(x.sql, {
      id: live,
      tenant: T.acme,
      key: "qc-a25-live",
      secretId: idOf(c),
    });
    await insertSourceRef(x.sql, {
      id: id(),
      tenant: T.acme,
      key: "qc-a25-del",
      secretId: idOf(c),
      deleted: true,
    });
    await insertSourceRef(x.sql, {
      id: id(),
      tenant: T.beta,
      key: "qc-a25-beta",
      secretId: idOf(c),
    });
    const l = await studio(x, "padmin", "GET", `?kind=source_credential&q=qc-a25`);
    expect(l.json?.items?.[0]?.used_by).toEqual([{ type: "source", id: live, key: "qc-a25-live" }]);
    await noWrite(
      () => studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`),
      409,
      "SECRET_IN_USE",
    );
    await x.sql`update hub.sources set deleted_at = now() where id = ${live}`;
    expect((await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`)).status).toBe(204);
  });
  it("HUB-FR-68 · A26 · used_by sắp theo (type, key): 2 provider + 0 source", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a26", value: val("a26") });
    expect(c.status).toBe(201);
    const [p1, p2] = [id(), id()];
    await insertProvider(x.sql, p1, "qc-a26-zeta", idOf(c));
    await insertProvider(x.sql, p2, "qc-a26-alpha", idOf(c));
    const g = await studio(x, "padmin", "GET", `/${idOf(c)}`);
    expect(g.json?.used_by?.map((u: { key: string }) => u.key)).toEqual([
      "qc-a26-alpha",
      "qc-a26-zeta",
    ]);
  });
});

describe("A28–A30 · Hub không có khoá ⇒ NOT_CONFIGURED [plan D11]", () => {
  it("HUB-FR-68 · A28 · POST / PUT có value ⇒ 409 NOT_CONFIGURED + 0 ghi; GET list / DELETE vẫn chạy", async () => {
    const c = await create(x, { kind: "provider_api_key", name: "qc-a28", value: val("a28") });
    expect(c.status).toBe(201);
    const hub = await extraHub(x, { hubSecretsKey: null });
    try {
      const body = { kind: "provider_api_key", name: "qc-a28b", value: val("a28b") };
      await noWrite(() => studio(x, "padmin", "POST", "", body, hub), 409, "NOT_CONFIGURED");
      await noWrite(
        () => studio(x, "padmin", "PUT", `/${idOf(c)}`, { version: 1, value: val("a28c") }, hub),
        409,
        "NOT_CONFIGURED",
      );
      expect((await studio(x, "padmin", "GET", "?q=qc-a28", undefined, hub)).status).toBe(200);
      expect(
        (await studio(x, "padmin", "DELETE", `/${idOf(c)}?version=1`, undefined, hub)).status,
      ).toBe(204);
    } finally {
      await hub.stop();
    }
  });
});
