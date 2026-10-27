// esign-multi · unit registry nhà cung cấp: tương thích ngược ESIGN_PROVIDER, thiếu biến ⇒ không khả dụng, thứ tự env, mặc định.
import { describe, expect, it } from "bun:test";
import { effectiveDefault, metaOf, providerEntriesOf, providerKeysOf } from "./esign.providers";

const DS = {
  DOCUSIGN_INTEGRATION_KEY: "ik",
  DOCUSIGN_USER_ID: "u",
  DOCUSIGN_ACCOUNT_ID: "a",
  DOCUSIGN_PRIVATE_KEY_FILE: "/run/secrets/ds.pem",
};

describe("providerKeysOf", () => {
  it("ESIGN_PROVIDERS theo thứ tự, chuẩn hoá, bỏ trùng/lạ/none", () => {
    expect(providerKeysOf({ ESIGN_PROVIDERS: " DocuSign , selfsign,docusign,vnpt,none" })).toEqual([
      "docusign",
      "selfsign",
    ]);
    expect(providerKeysOf({ ESIGN_PROVIDERS: "selfsign,docusign" })).toEqual([
      "selfsign",
      "docusign",
    ]);
  });
  it("tương thích ngược: chỉ ESIGN_PROVIDER=x ⇒ [x]; none/vắng ⇒ []; ESIGN_PROVIDERS thắng", () => {
    expect(providerKeysOf({ ESIGN_PROVIDER: "docusign" })).toEqual(["docusign"]);
    expect(providerKeysOf({ ESIGN_PROVIDER: "none" })).toEqual([]);
    expect(providerKeysOf({})).toEqual([]);
    expect(providerKeysOf({ ESIGN_PROVIDER: "docusign", ESIGN_PROVIDERS: "selfsign" })).toEqual([
      "selfsign",
    ]);
    expect(providerKeysOf({ ESIGN_PROVIDER: "selfsign", ESIGN_PROVIDERS: "  " })).toEqual([
      "selfsign",
    ]);
  });
});

describe("providerEntriesOf", () => {
  it("docusign thiếu biến ⇒ không khả dụng; đủ ⇒ khả dụng; selfsign luôn; misa chưa có adapter", () => {
    const env = { ESIGN_PROVIDERS: "docusign,selfsign,misa" };
    expect(providerEntriesOf(env).map((e) => [e.key, e.available])).toEqual([
      ["docusign", false],
      ["selfsign", true],
      ["misa", false],
    ]);
    const on = providerEntriesOf({ ...env, ...DS });
    expect(on[0]).toEqual({
      key: "docusign",
      label: "DocuSign",
      kind: "envelope",
      legal: true,
      available: true,
    });
    expect(on[1]).toMatchObject({ key: "selfsign", kind: "ca", legal: false });
  });
  it("khoá lạ (seam test) ⇒ nhãn = khoá, pháp lý theo demo", () => {
    expect(metaOf("fake")).toEqual({ label: "fake", kind: "envelope", legal: true });
    expect(metaOf("fake", true).legal).toBe(false);
  });
});

describe("effectiveDefault", () => {
  const e = [
    { key: "docusign", available: false },
    { key: "selfsign", available: true },
    { key: "misa", available: true },
  ];
  it("đã chọn + khả dụng ⇒ giữ; vắng/không khả dụng ⇒ khả dụng đầu tiên; không có ⇒ null", () => {
    expect(effectiveDefault(e, "misa")).toBe("misa");
    expect(effectiveDefault(e, null)).toBe("selfsign");
    expect(effectiveDefault(e, "docusign")).toBe("selfsign");
    expect(effectiveDefault([], "docusign")).toBeNull();
  });
});
