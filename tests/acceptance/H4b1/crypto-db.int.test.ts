// HUB-FR-68 · AC-H4b1-02 · Q2 · plan D3, D4 · test-plan H4b1 §3 A70–A75: bản mã do API ghi vào `hub.secrets` — khác bản rõ,
// IV 12 byte mới mỗi lần ghi (cùng giá trị), giải được bằng bộ đối chứng theo spec với AAD `hub.secrets:<id>:<kind>:<tenant|->:1`
// (đúng id hàng ⇒ id sinh trước khi mã hoá), sai AAD/1 byte ⇒ giải thất bại; thay giá trị giữ AAD (cùng id/kind/tenant).
// Đỏ trước code: route chưa có ⇒ 404 ≠ 201.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Ctx,
  create,
  idOf,
  type Meta,
  secretRow,
  specOpen,
  startH4b1,
  studio,
  T,
  val,
} from "./_h4b1";

let x: Ctx;
beforeAll(async () => {
  x = await startH4b1();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

const tryOpen = (
  row: { ciphertext?: Uint8Array; iv?: Uint8Array } | undefined,
  m: Meta,
  kv = 1,
) => {
  try {
    return specOpen(row?.ciphertext ?? new Uint8Array(0), row?.iv ?? new Uint8Array(0), m, kv);
  } catch {
    return "FAIL";
  }
};

describe("A70–A75 · bản mã trong DB [AC-H4b1-02]", () => {
  it("HUB-FR-68 · AC-H4b1-02 · A70 · ciphertext ≠ bản rõ (không chứa chuỗi UTF-8), iv 12 byte, độ dài = len + 16", async () => {
    const v = val("a70");
    const r = await create(x, { kind: "provider_api_key", name: "qc-a70", value: v });
    expect(r.status).toBe(201);
    const row = await secretRow(x.sql, idOf(r));
    const ct = Buffer.from(row?.ciphertext ?? []);
    expect({
      iv: Buffer.from(row?.iv ?? []).length,
      len: ct.length,
      has: ct.includes(Buffer.from(v)),
    }).toEqual({
      iv: 12,
      len: Buffer.byteLength(v) + 16,
      has: false,
    });
  });
  it("HUB-FR-68 · AC-H4b1-02 · A71 · hai secret cùng giá trị ⇒ iv khác nhau, bản mã khác nhau", async () => {
    const v = val("a71");
    const a = await create(x, { kind: "provider_api_key", name: "qc-a71a", value: v });
    const b = await create(x, { kind: "provider_api_key", name: "qc-a71b", value: v });
    expect([a.status, b.status]).toEqual([201, 201]);
    const [ra, rb] = [await secretRow(x.sql, idOf(a)), await secretRow(x.sql, idOf(b))];
    expect(Buffer.from(ra?.iv ?? []).equals(Buffer.from(rb?.iv ?? []))).toBe(false);
    expect(Buffer.from(ra?.ciphertext ?? []).equals(Buffer.from(rb?.ciphertext ?? []))).toBe(false);
  });
  it("HUB-FR-68 · AC-H4b1-02 · Q2 · A72 · giải bằng bộ đối chứng theo spec (AAD id‖kind‖tenant‖key_version) ⇒ đúng bản rõ — provider (tenant `-`) và source acme", async () => {
    const vp = val("a72p");
    const vs = val("a72s");
    const p = await create(x, { kind: "provider_api_key", name: "qc-a72p", value: vp });
    const s = await create(x, {
      kind: "source_credential",
      name: "qc-a72s",
      value: vs,
      tenant_id: T.acme,
    });
    expect([p.status, s.status]).toEqual([201, 201]);
    expect([
      tryOpen(await secretRow(x.sql, idOf(p)), {
        id: idOf(p),
        kind: "provider_api_key",
        tenantId: null,
      }),
      tryOpen(await secretRow(x.sql, idOf(s)), {
        id: idOf(s),
        kind: "source_credential",
        tenantId: T.acme,
      }),
    ]).toEqual([vp, vs]);
  });
  it("HUB-FR-68 · AC-H4b1-02 · A73 · đổi kind / tenant_id / id / key_version trong AAD hoặc sửa 1 byte bản mã ⇒ giải thất bại", async () => {
    const r = await create(x, {
      kind: "kh_api_key",
      name: "qc-a73",
      value: val("a73"),
      tenant_id: T.acme,
    });
    expect(r.status).toBe(201);
    const row = await secretRow(x.sql, idOf(r));
    const m = { id: idOf(r), kind: "kh_api_key", tenantId: T.acme as string | null };
    const flipped = Buffer.from(row?.ciphertext ?? []);
    flipped[0] = (flipped[0] ?? 0) ^ 0x01;
    expect([
      tryOpen(row, m),
      tryOpen(row, { ...m, kind: "source_credential" }),
      tryOpen(row, { ...m, tenantId: T.beta }),
      tryOpen(row, { ...m, tenantId: null }),
      tryOpen(row, { ...m, id: "a4b10000-0000-4000-8000-000000000997" }),
      tryOpen(row, m, 2),
      tryOpen({ ...row, ciphertext: flipped }, m),
    ]).toEqual([val("a73"), "FAIL", "FAIL", "FAIL", "FAIL", "FAIL", "FAIL"]);
  });
  it("HUB-FR-69 · AC-H4b1-02 · A74 · PUT cùng giá trị ⇒ iv mới, bản mã mới, vẫn giải được với cùng AAD (id/kind/tenant không đổi)", async () => {
    const v = val("a74");
    const r = await create(x, {
      kind: "source_credential",
      name: "qc-a74",
      value: v,
      tenant_id: T.beta,
    });
    expect(r.status).toBe(201);
    const before = await secretRow(x.sql, idOf(r));
    expect((await studio(x, "padmin", "PUT", `/${idOf(r)}`, { version: 1, value: v })).status).toBe(
      200,
    );
    const after = await secretRow(x.sql, idOf(r));
    expect(Buffer.from(after?.iv ?? []).equals(Buffer.from(before?.iv ?? []))).toBe(false);
    expect(tryOpen(after, { id: idOf(r), kind: "source_credential", tenantId: T.beta })).toBe(v);
    expect({ kind: after?.kind, tenant: after?.tenant_id, version: after?.version }).toEqual({
      kind: "source_credential",
      tenant: T.beta,
      version: 2,
    });
  });
  it("HUB-FR-68 · A75 · giá trị không trim: khoảng trắng đầu/cuối giữ nguyên trong bản rõ giải ra", async () => {
    const v = `  ${val("a75")}  `;
    const r = await create(x, { kind: "provider_api_key", name: "qc-a75", value: v });
    expect(r.status).toBe(201);
    expect(
      tryOpen(await secretRow(x.sql, idOf(r)), {
        id: idOf(r),
        kind: "provider_api_key",
        tenantId: null,
      }),
    ).toBe(v);
  });
});
