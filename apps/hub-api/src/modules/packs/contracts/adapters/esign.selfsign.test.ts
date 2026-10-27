// cf-esign-docusign · unit: ký thử (selfsign) — demo, không mạng, đọc trạng thái không hoàn tất (esign-fix), "Ký ngay" quay thẳng về HĐ, không giữ PDF;
// registry theo `ESIGN_PROVIDERS` (esign-multi; tương thích ngược `ESIGN_PROVIDER`; docusign thiếu biến ⇒ không khả dụng).
import { describe, expect, it } from "bun:test";
import { envESignRegistry } from "../esign.mount";
import { selfsignProvider } from "./esign.selfsign";

describe("selfsignProvider", () => {
  it("demo, đọc trạng thái luôn 'sent' (làm mới không hoàn tất), view = returnUrl, combinedPdf null", async () => {
    const p = selfsignProvider();
    expect({ key: p.key, demo: p.demo, webhook: p.webhook }).toEqual({
      key: "selfsign",
      demo: true,
      webhook: undefined,
    });
    const { envelopeId } = await p.createEnvelope({
      subject: "x",
      title: "x",
      number: null,
      document: { name: "a.pdf", bytes: new Uint8Array() },
      signers: [],
    });
    expect(envelopeId).toMatch(/^selfsign-/);
    expect(await p.getEnvelope(envelopeId)).toMatchObject({ status: "sent", completedAt: null });
    expect(
      await p.recipientView(
        envelopeId,
        { name: "a", email: "a@x", clientUserId: "u" },
        "http://h/contracts/1",
      ),
    ).toBe("http://h/contracts/1");
    expect(await p.combinedPdf(envelopeId)).toBeNull();
  });
});

describe("envESignRegistry (ESIGN_PROVIDERS, esign-multi)", () => {
  const DS = {
    DOCUSIGN_INTEGRATION_KEY: "ik",
    DOCUSIGN_USER_ID: "u",
    DOCUSIGN_ACCOUNT_ID: "a",
    DOCUSIGN_PRIVATE_KEY_FILE: "/x.pem",
  };
  it("vắng ⇒ rỗng; ESIGN_PROVIDER=selfsign tương thích ngược; docusign thiếu biến ⇒ không khả dụng", () => {
    expect(envESignRegistry({}).entries).toEqual([]);
    expect(envESignRegistry({ ESIGN_PROVIDER: "selfsign" }).get("selfsign")?.key).toBe("selfsign");
    const r = envESignRegistry({ ESIGN_PROVIDERS: "docusign,selfsign" });
    expect(r.entries.map((e) => [e.key, e.available])).toEqual([
      ["docusign", false],
      ["selfsign", true],
    ]);
    expect(r.get("docusign")).toBeNull();
  });
  it("đủ biến ⇒ docusign khả dụng song song selfsign; webhook không khoá HMAC ⇒ từ chối", () => {
    const r = envESignRegistry({ ESIGN_PROVIDERS: "docusign,selfsign", ...DS });
    expect(r.entries.every((e) => e.available)).toBe(true);
    const p = r.get("docusign");
    expect(p?.key).toBe("docusign");
    expect(p?.webhook?.(new Uint8Array(), () => undefined)).toEqual({ ok: false });
    expect(envESignRegistry({ ESIGN_PROVIDER: "docusign", ...DS }).get("docusign")?.key).toBe(
      "docusign",
    );
  });
});
