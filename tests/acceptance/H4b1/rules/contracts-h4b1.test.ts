// HUB-FR-68 · Q4, Q7, Q11 · spec §3 Kiểu chung · test-plan H4b1 §3 R50–R61: contract `@ai/contracts/hub-admin` khối
// secrets (`HUB_SECRET_KINDS`, name/value, `HubSecretSchema` strict không giá trị, request create/rotate/list, used_by,
// `HUB_SECRET_ERRORS`). Nạp động ⇒ export chưa có ⇒ đỏ ở expect.
import { describe, expect, it } from "bun:test";
import { loadHubAdmin } from "./_rules";

const ID = "a4b10000-0000-4000-8000-000000000201";
const TEN = "a4b10000-0000-4000-8000-000000000202";
const AT = "2026-10-13T01:00:00.000Z";
type S = { safeParse?: (v: unknown) => { success: boolean; data?: unknown } };
const ok = (s: S | undefined, v: unknown) => {
  expect(typeof s?.safeParse).toBe("function");
  return s?.safeParse?.(v).success;
};
const meta = {
  id: ID,
  kind: "source_credential",
  tenant: { id: TEN, key: "acme", name: "Acme Corp" },
  name: "git-acme",
  version: 2,
  used_by: [{ type: "source", id: ID, key: "app-repo" }],
  created_at: AT,
  updated_at: AT,
  updated_by: "padmin",
};

describe("R50–R53 · kiểu chung [spec §3 · Q4]", () => {
  it("HUB-FR-68 · R50 · HUB_SECRET_KINDS = [provider_api_key, kh_api_key, source_credential]", async () => {
    expect((await loadHubAdmin()).HUB_SECRET_KINDS).toEqual([
      "provider_api_key",
      "kh_api_key",
      "source_credential",
    ]);
  });
  it("HUB-FR-68 · Q4 · R51 · HubSecretNameSchema: hợp lệ `anthropic-main`, `ab`, `A_b-9`, 64 ký tự; trim trước regex", async () => {
    const s = (await loadHubAdmin()).HubSecretNameSchema;
    expect(
      ["anthropic-main", "ab", "A_b-9", "x".repeat(64), "  git_Token  "].map((v) => ok(s, v)),
    ).toEqual([true, true, true, true, true]);
    expect(s.safeParse("  git_Token  ").data).toBe("git_Token");
  });
  it("HUB-FR-68 · Q4 · R52 · HubSecretNameSchema từ chối: 1 ký tự, 65 ký tự, khoảng trắng giữa, dấu chấm, chữ có dấu, rỗng", async () => {
    const s = (await loadHubAdmin()).HubSecretNameSchema;
    expect(["a", "x".repeat(65), "has space", "a.b", "khoá", ""].map((v) => ok(s, v))).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
  it("HUB-FR-68 · R53 · HubSecretValueSchema: 8 / 2048 đơn vị UTF-16 pass; 7 / 2049 fail; không trim (giữ khoảng trắng đầu/cuối)", async () => {
    const s = (await loadHubAdmin()).HubSecretValueSchema;
    expect(
      ["12345678", "x".repeat(2048), "1234567", "x".repeat(2049)].map((v) => ok(s, v)),
    ).toEqual([true, true, false, false]);
    expect(s.safeParse("  qc-val-12  ").data).toBe("  qc-val-12  ");
  });
});

describe("R54–R56 · HubSecretSchema chỉ metadata [spec §2 Chỉ ghi · Q11]", () => {
  it("HUB-FR-68 · R54 · metadata đủ trường (tenant ref, used_by) ⇒ pass; tenant null ⇒ pass", async () => {
    const s = (await loadHubAdmin()).HubSecretSchema;
    expect([
      ok(s, meta),
      ok(s, { ...meta, kind: "provider_api_key", tenant: null, used_by: [] }),
    ]).toEqual([true, true]);
  });
  it("HUB-FR-68 · AC-H4b1-01 · R55 · strict: thêm value / ciphertext / iv / key_version / last4 ⇒ fail", async () => {
    const s = (await loadHubAdmin()).HubSecretSchema;
    const extra = [
      { value: "sk-qc-leak-12345" },
      { ciphertext: "AAAA" },
      { iv: "AAAA" },
      { key_version: 1 },
      { last4: "2345" },
    ];
    expect(extra.map((e) => ok(s, { ...meta, ...e }))).toEqual([false, false, false, false, false]);
  });
  it("HUB-FR-68 · R56 · used_by.type ∉ {provider, source, knowledge_hub} ⇒ fail; version 0 ⇒ fail", async () => {
    const s = (await loadHubAdmin()).HubSecretSchema;
    expect([
      ok(s, { ...meta, used_by: [{ type: "agent", id: ID, key: "x" }] }),
      ok(s, { ...meta, version: 0 }),
      ok(s, { ...meta, used_by: [{ type: "knowledge_hub", id: ID, key: "kh" }] }),
    ]).toEqual([false, false, true]);
  });
});

describe("R57–R61 · request + mã lỗi [spec §3 A]", () => {
  it("HUB-FR-68 · R57 · HubSecretCreateRequestSchema: {kind, name, value[, tenant_id]} pass; thừa `version` ⇒ fail; kind lạ ⇒ fail", async () => {
    const s = (await loadHubAdmin()).HubSecretCreateRequestSchema;
    const b = { kind: "kh_api_key", name: "kh-main", value: "qc-kh-value-1" };
    expect([
      ok(s, b),
      ok(s, { ...b, tenant_id: TEN }),
      ok(s, { ...b, version: 1 }),
      ok(s, { ...b, kind: "app_key" }),
    ]).toEqual([true, true, false, false]);
  });
  it("HUB-FR-69 · R58 · HubSecretRotateRequestSchema: {version ≥ 1, value} pass; thiếu version / version 0 / có name ⇒ fail", async () => {
    const s = (await loadHubAdmin()).HubSecretRotateRequestSchema;
    const b = { version: 1, value: "qc-rotate-val-1" };
    expect([
      ok(s, b),
      ok(s, { value: b.value }),
      ok(s, { ...b, version: 0 }),
      ok(s, { ...b, name: "doi-ten" }),
    ]).toEqual([true, false, false, false]);
  });
  it("HUB-FR-68 · R59 · HubSecretListQuerySchema: rỗng ⇒ limit 100; limit 101 ⇒ fail; q 65 ký tự ⇒ fail", async () => {
    const s = (await loadHubAdmin()).HubSecretListQuerySchema;
    expect(typeof s?.safeParse).toBe("function");
    expect((s.safeParse({}).data as { limit?: number })?.limit).toBe(100);
    expect([
      ok(s, { limit: "101" }),
      ok(s, { q: "x".repeat(65) }),
      ok(s, { kind: "kh_api_key" }),
    ]).toEqual([false, false, true]);
  });
  it("HUB-FR-68 · R60 · HUB_SECRET_ERRORS: SECRET_NAME_TAKEN 409, SECRET_IN_USE 409", async () => {
    const e = (await loadHubAdmin()).HUB_SECRET_ERRORS;
    expect({ taken: e?.SECRET_NAME_TAKEN, inUse: e?.SECRET_IN_USE }).toEqual({
      taken: 409,
      inUse: 409,
    });
  });
  it("HUB-FR-68 · R61 · SecretUsedBySchema: key 1..64; id uuid", async () => {
    const s = (await loadHubAdmin()).SecretUsedBySchema;
    expect([
      ok(s, { type: "provider", id: ID, key: "anthropic-api" }),
      ok(s, { type: "provider", id: ID, key: "" }),
      ok(s, { type: "provider", id: "x", key: "k" }),
      ok(s, { type: "source", id: ID, key: "k".repeat(65) }),
    ]).toEqual([true, false, false, false]);
  });
});
