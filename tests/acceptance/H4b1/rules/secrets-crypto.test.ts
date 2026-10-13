// HUB-FR-68 · HUB-FR-04 · AC-H4b1-02 · AC-H4b1-06 (vế thuần) · Q2, Q6 · plan §2.2, D3 · test-plan H4b1 §3 R20–R41:
// `secrets.crypto.ts` — đọc khoá (thiếu/sai ⇒ lỗi rõ, không chứa giá trị), khác master key, AAD theo spec, seal (IV 12
// byte mới mỗi lần, bản mã ‖ tag 16), open (sai khoá/AAD/tag/iv/key_version ⇒ lỗi cố định), tương thích hai chiều với
// bộ mã hoá đối chứng viết theo spec (node:crypto trong test). Đỏ trước code: module chưa có ⇒ `fn()` ném.
import { describe, expect, it } from "bun:test";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { fn, loadCrypto, msgOf } from "./_rules";

const ID = "a4b10000-0000-4000-8000-000000000101";
const TEN = "a4b10000-0000-4000-8000-000000000102";
const KEY = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const KEY_B64 = Buffer.from(KEY).toString("base64");
const KEY2 = Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 5) & 0xff);
const K = { version: 1, key: KEY };
const PROV = { id: ID, kind: "provider_api_key", tenantId: null };
const SRC = { id: ID, kind: "source_credential", tenantId: TEN };
const V = "sk-ant-qc-H4B1-crypto-Zx9Pq7Lm";
const FAIL = "hub-secrets: giải mã thất bại";
const u8 = (b: Uint8Array) => Buffer.from(b);

const aad = (m: { id: string; kind: string; tenantId: string | null }, kv = 1) =>
  Buffer.from(`hub.secrets:${m.id}:${m.kind}:${m.tenantId ?? "-"}:${kv}`, "utf8");

describe("R20–R25 · khoá HUB_SECRETS_KEY [spec §2 Mã hoá · Q2 · D10]", () => {
  it("HUB-FR-68 · AC-H4b1-06 · R20 · parseHubSecretsKey(base64 32 byte) ⇒ {version 1, key 32 byte đúng}", async () => {
    const k = fn(await loadCrypto(), "parseHubSecretsKey")(KEY_B64);
    expect({ version: k.version, key: u8(k.key).toString("hex") }).toEqual({
      version: 1,
      key: u8(KEY).toString("hex"),
    });
  });
  it('HUB-FR-68 · AC-H4b1-06 · R21 · thiếu (undefined, rỗng) ⇒ Error "HUB_SECRETS_KEY thiếu"', async () => {
    const p = fn(await loadCrypto(), "parseHubSecretsKey");
    expect([msgOf(() => p(undefined)), msgOf(() => p(""))]).toEqual([
      "HUB_SECRETS_KEY thiếu",
      "HUB_SECRETS_KEY thiếu",
    ]);
  });
  it('HUB-FR-68 · AC-H4b1-06 · R22 · 16 byte / 33 byte / không phải base64 ⇒ "HUB_SECRETS_KEY không hợp lệ"; thông điệp không chứa giá trị', async () => {
    const p = fn(await loadCrypto(), "parseHubSecretsKey");
    const bad = [
      Buffer.from(KEY.subarray(0, 16)).toString("base64"),
      Buffer.concat([u8(KEY), Buffer.from([1])]).toString("base64"),
      "khong-phai-base64-QC-MARK!!",
    ];
    const msgs = bad.map((b) => msgOf(() => p(b)));
    expect(msgs).toEqual(bad.map(() => "HUB_SECRETS_KEY không hợp lệ"));
    for (const [i, b] of bad.entries()) expect(msgs[i]).not.toContain(b);
  });
  it('HUB-FR-04 · AC-H4b1-06 · R23 · assertDistinctFromMaster: trùng byte ⇒ Error "HUB_SECRETS_KEY phải khác SECRET_MASTER_KEY"', async () => {
    const a = fn(await loadCrypto(), "assertDistinctFromMaster");
    expect(msgOf(() => a(K, KEY_B64))).toBe("HUB_SECRETS_KEY phải khác SECRET_MASTER_KEY");
  });
  it("HUB-FR-04 · R24 · khác master hoặc master vắng ⇒ không ném", async () => {
    const a = fn(await loadCrypto(), "assertDistinctFromMaster");
    expect([msgOf(() => a(K, u8(KEY2).toString("base64"))), msgOf(() => a(K, undefined))]).toEqual([
      "ok",
      "ok",
    ]);
  });
  it("HUB-FR-68 · AC-H4b1-06 · R25 · selfTestHubSecretsKey(khoá đúng) không ném", async () => {
    const m = await loadCrypto();
    expect(msgOf(() => fn(m, "selfTestHubSecretsKey")(K))).toBe("ok");
  });
});

describe("R26–R30 · AAD + seal [spec §2 Mã hoá · Q2 · D3]", () => {
  it("HUB-FR-68 · AC-H4b1-02 · R26 · hubSecretAad = UTF-8 `hub.secrets:<id>:<kind>:<tenant|->:<key_version>`", async () => {
    const f = fn(await loadCrypto(), "hubSecretAad");
    expect([u8(f(PROV, 1)).toString("utf8"), u8(f(SRC, 2)).toString("utf8")]).toEqual([
      `hub.secrets:${ID}:provider_api_key:-:1`,
      `hub.secrets:${ID}:source_credential:${TEN}:2`,
    ]);
  });
  it("HUB-FR-68 · AC-H4b1-02 · R27 · seal: iv 12 byte, keyVersion = khoá, bản mã = len(UTF-8) + 16, không chứa bản rõ", async () => {
    const s = fn(await loadCrypto(), "sealHubSecret")(K, PROV, V);
    expect({ iv: s.iv.length, kv: s.keyVersion, ct: s.ciphertext.length }).toEqual({
      iv: 12,
      kv: 1,
      ct: Buffer.byteLength(V, "utf8") + 16,
    });
    expect(u8(s.ciphertext).includes(Buffer.from(V))).toBe(false);
  });
  it("HUB-FR-68 · AC-H4b1-02 · R28 · hai lần seal cùng giá trị ⇒ iv khác, bản mã khác", async () => {
    const seal = fn(await loadCrypto(), "sealHubSecret");
    const a = seal(K, PROV, V);
    const b = seal(K, PROV, V);
    expect(u8(a.iv).equals(u8(b.iv))).toBe(false);
    expect(u8(a.ciphertext).equals(u8(b.ciphertext))).toBe(false);
  });
  it("HUB-FR-68 · R29 · rand tiêm được: seal dùng đúng 12 byte từ rand làm iv", async () => {
    const seal = fn(await loadCrypto(), "sealHubSecret");
    const calls: number[] = [];
    const rand = (n: number) => {
      calls.push(n);
      return new Uint8Array(n).fill(7);
    };
    const s = seal(K, PROV, V, rand);
    expect({ calls, iv: u8(s.iv).toString("hex") }).toEqual({ calls: [12], iv: "07".repeat(12) });
  });
  it("HUB-FR-68 · AC-H4b1-02 · R30 · bản mã sản phẩm giải được bằng bộ đối chứng theo spec (AES-256-GCM, AAD spec, tag 16 cuối)", async () => {
    const s = fn(await loadCrypto(), "sealHubSecret")(K, SRC, V);
    const ct = u8(s.ciphertext);
    const d = createDecipheriv("aes-256-gcm", KEY, u8(s.iv));
    d.setAAD(aad(SRC));
    d.setAuthTag(ct.subarray(ct.length - 16));
    const out = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(
      "utf8",
    );
    expect(out).toBe(V);
  });
});

describe("R31–R41 · open [AC-H4b1-02 · plan §2.2]", () => {
  const sealed = async (m = SRC, v = V) => fn(await loadCrypto(), "sealHubSecret")(K, m, v);
  const open = async () => fn(await loadCrypto(), "openHubSecret");

  it("HUB-FR-68 · AC-H4b1-02 · R31 · khứ hồi seal → open (ASCII, tiếng Việt + emoji, JSON client_id/secret Q7)", async () => {
    const o = await open();
    const vals = [
      V,
      "khoá-bí-mật-🔑-Đ-QC-12345",
      JSON.stringify({ client_id: "kh-ns-acme", client_secret: "QcSecret-H4B1-xyz" }),
    ];
    const got = [];
    for (const v of vals) got.push(o(K, SRC, await sealed(SRC, v)));
    expect(got).toEqual(vals);
  });
  it("HUB-FR-68 · AC-H4b1-02 · R32 · bản mã dựng bởi bộ đối chứng theo spec ⇒ openHubSecret giải đúng", async () => {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", KEY, iv);
    c.setAAD(aad(PROV));
    const ct = Buffer.concat([c.update(V, "utf8"), c.final(), c.getAuthTag()]);
    expect((await open())(K, PROV, { ciphertext: ct, iv, keyVersion: 1 })).toBe(V);
  });
  const tamper: [
    string,
    (s: { ciphertext: Uint8Array; iv: Uint8Array; keyVersion: number }) => unknown[],
  ][] = [
    [
      "R33 · sửa 1 byte bản mã",
      (s) => {
        const ct = Buffer.from(s.ciphertext);
        ct[0] = (ct[0] ?? 0) ^ 0x01;
        return [K, SRC, { ...s, ciphertext: ct }];
      },
    ],
    [
      "R34 · sửa 1 byte tag (byte cuối)",
      (s) => {
        const ct = Buffer.from(s.ciphertext);
        ct[ct.length - 1] = (ct[ct.length - 1] ?? 0) ^ 0x80;
        return [K, SRC, { ...s, ciphertext: ct }];
      },
    ],
    ["R35 · đổi kind (AAD)", (s) => [K, { ...SRC, kind: "kh_api_key" }, s]],
    [
      "R36 · đổi tenant_id (AAD)",
      (s) => [K, { ...SRC, tenantId: "a4b10000-0000-4000-8000-000000000103" }, s],
    ],
    ["R37 · tenant_id → null (AAD `-`)", (s) => [K, { ...SRC, tenantId: null }, s]],
    ["R38 · đổi id (AAD)", (s) => [K, { ...SRC, id: "a4b10000-0000-4000-8000-000000000104" }, s]],
    ["R39 · key_version 2 (AAD)", (s) => [K, SRC, { ...s, keyVersion: 2 }]],
    ["R40 · sai khoá", (s) => [{ version: 1, key: KEY2 }, SRC, s]],
    ["R41 · đổi iv", (s) => [K, SRC, { ...s, iv: new Uint8Array(12).fill(9) }]],
  ];
  for (const [name, mk] of tamper)
    it(`HUB-FR-68 · AC-H4b1-02 · ${name} ⇒ ném đúng "${FAIL}", thông điệp không chứa giá trị`, async () => {
      const o = await open();
      const args = mk(await sealed());
      const m = msgOf(() => o(...args));
      expect(m).toBe(FAIL);
      expect(m).not.toContain(V);
    });
});
