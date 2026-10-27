// cf-esign-docusign · unit: map trạng thái DocuSign ⇒ trạng thái lưu; cấu hình env (thiếu ⇒ tắt); webhook ⇒ envelopeId; người ký mặc định.
import { describe, expect, it } from "bun:test";
import {
  defaultSigners,
  docusignConfigOf,
  envelopeIdOfWebhook,
  isOpen,
  mapEnvelopeStatus,
  signAnchors,
  signaturePageHtml,
} from "./esign.rules";

describe("mapEnvelopeStatus", () => {
  it("trạng thái DocuSign ⇒ trạng thái lưu (không phân biệt hoa thường)", () => {
    expect(mapEnvelopeStatus("sent")).toBe("sent");
    expect(mapEnvelopeStatus("Created")).toBe("sent");
    expect(mapEnvelopeStatus("delivered")).toBe("delivered");
    expect(mapEnvelopeStatus("signed")).toBe("delivered");
    expect(mapEnvelopeStatus("completed")).toBe("completed");
    expect(mapEnvelopeStatus("declined")).toBe("declined");
    expect(mapEnvelopeStatus("voided")).toBe("voided");
    expect(mapEnvelopeStatus("deleted")).toBe("voided");
    expect(mapEnvelopeStatus("weird")).toBeNull();
  });
  it("chỉ sent/delivered là đang chờ ký", () => {
    expect(isOpen("sent")).toBe(true);
    expect(isOpen("delivered")).toBe(true);
    expect(isOpen("completed")).toBe(false);
    expect(isOpen("declined")).toBe(false);
  });
});

describe("docusignConfigOf (env)", () => {
  const full = {
    DOCUSIGN_INTEGRATION_KEY: "ik",
    DOCUSIGN_USER_ID: "u",
    DOCUSIGN_ACCOUNT_ID: "a",
    DOCUSIGN_PRIVATE_KEY_FILE: "/run/secrets/ds.pem",
  };
  it("đủ ⇒ có mặc định demo + account-d", () => {
    expect(docusignConfigOf(full)).toEqual({
      integrationKey: "ik",
      userId: "u",
      accountId: "a",
      baseUri: "https://demo.docusign.net/restapi",
      oauthHost: "account-d.docusign.com",
      privateKeyFile: "/run/secrets/ds.pem",
      hmacKey: null,
    });
  });
  it("thiếu một biến bắt buộc ⇒ null (tính năng tắt)", () => {
    for (const k of Object.keys(full)) expect(docusignConfigOf({ ...full, [k]: "" })).toBeNull();
  });
  it("base URI bỏ / cuối; HMAC tuỳ chọn", () => {
    const c = docusignConfigOf({
      ...full,
      DOCUSIGN_BASE_URI: "https://x.test/restapi/",
      DOCUSIGN_OAUTH_HOST: "o.test",
      DOCUSIGN_CONNECT_HMAC_KEY: "k",
    });
    expect(c).toMatchObject({
      baseUri: "https://x.test/restapi",
      oauthHost: "o.test",
      hmacKey: "k",
    });
  });
});

describe("envelopeIdOfWebhook", () => {
  it("JSON Connect (data.envelopeId hoặc envelopeId) ⇒ id; còn lại ⇒ null", () => {
    expect(
      envelopeIdOfWebhook({ event: "envelope-completed", data: { envelopeId: "abc-1" } }),
    ).toBe("abc-1");
    expect(envelopeIdOfWebhook({ envelopeId: "abc-2" })).toBe("abc-2");
    expect(envelopeIdOfWebhook({ data: { envelopeId: "x".repeat(200) } })).toBeNull();
    expect(envelopeIdOfWebhook({ data: { envelopeId: "a b" } })).toBeNull();
    expect(envelopeIdOfWebhook(null)).toBeNull();
  });
});

describe("defaultSigners", () => {
  it("bên mình = user hiện tại; đối tác = email liên hệ (vắng ⇒ rỗng để sửa)", () => {
    expect(
      defaultSigners({
        me: { name: "Lan", email: "lan@a.vn" },
        partner: { name: "B", email: null },
      }),
    ).toEqual([
      { role: "company", name: "Lan", email: "lan@a.vn" },
      { role: "partner", name: "B", email: "" },
    ]);
  });
});

describe("signaturePageHtml (esign-multi)", () => {
  const signers = [
    { role: "company" as const, name: "Nguyễn Lan", email: "lan@a.vn" },
    { role: "partner" as const, name: "<b>Đối tác</b> & Co", email: "b@p.vn" },
  ];
  it("Unicode giữ dấu, escape trường người dùng, đủ anchor theo số người ký", () => {
    const h = signaturePageHtml({ title: 'HĐ "mua" <script>', number: "01/2026", signers });
    expect(h).toContain("TRANG KÝ / SIGNATURE PAGE");
    expect(h).toContain("Nguyễn Lan");
    expect(h).toContain("&lt;b&gt;Đối tác&lt;/b&gt; &amp; Co");
    expect(h).toContain("HĐ &quot;mua&quot; &lt;script&gt;");
    expect(h).not.toContain("<script>");
    expect(h).toContain("01/2026");
    expect(h).toContain("Bên A / Party A");
    expect(h).toContain("Bên B / Party B");
    for (const i of [0, 1]) {
      expect(h).toContain(signAnchors(i).sign);
      expect(h).toContain(signAnchors(i).date);
    }
    expect(h).not.toContain(signAnchors(2).sign);
  });
  it("anchor dạng \\sN\\ / \\dN\\; vắng số HĐ ⇒ không dòng số", () => {
    expect(signAnchors(0)).toEqual({ sign: "\\s1\\", date: "\\d1\\" });
    expect(signaturePageHtml({ title: "x", number: null, signers })).not.toContain("Số / No.");
  });
});
