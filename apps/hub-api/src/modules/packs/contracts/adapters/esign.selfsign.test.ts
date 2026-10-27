// cf-esign-docusign · unit: ký thử (selfsign) — demo, không mạng, ký xong ở lần đọc đầu, "Ký ngay" quay thẳng về HĐ, không giữ PDF;
// chọn nhà cung cấp theo `ESIGN_PROVIDER` (mặc định none ⇒ tắt; docusign thiếu biến ⇒ tắt).
import { describe, expect, it } from "bun:test";
import { envESignProvider } from "../esign.mount";
import { selfsignProvider } from "./esign.selfsign";

describe("selfsignProvider", () => {
  it("demo, envelope ký xong khi đọc, view = returnUrl, combinedPdf null", async () => {
    const p = selfsignProvider({ now: () => new Date("2026-10-27T01:00:00Z") });
    expect({ key: p.key, demo: p.demo, webhook: p.webhook }).toEqual({
      key: "selfsign",
      demo: true,
      webhook: undefined,
    });
    const { envelopeId } = await p.createEnvelope({
      subject: "x",
      document: { name: "a.pdf", bytes: new Uint8Array() },
      signers: [],
    });
    expect(envelopeId).toMatch(/^selfsign-/);
    expect(await p.getEnvelope(envelopeId)).toMatchObject({
      status: "completed",
      completedAt: "2026-10-27T01:00:00.000Z",
    });
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

describe("envESignProvider (ESIGN_PROVIDER)", () => {
  it("none mặc định; selfsign; docusign thiếu biến ⇒ null; đủ biến ⇒ docusign", () => {
    expect(envESignProvider({})).toBeNull();
    expect(envESignProvider({ ESIGN_PROVIDER: "selfsign" })?.key).toBe("selfsign");
    expect(envESignProvider({ ESIGN_PROVIDER: "docusign" })).toBeNull();
    const p = envESignProvider({
      ESIGN_PROVIDER: "docusign",
      DOCUSIGN_INTEGRATION_KEY: "ik",
      DOCUSIGN_USER_ID: "u",
      DOCUSIGN_ACCOUNT_ID: "a",
      DOCUSIGN_PRIVATE_KEY_FILE: "/x.pem",
    });
    expect(p?.key).toBe("docusign");
    expect(p?.webhook?.(new Uint8Array(), () => undefined)).toEqual({ ok: false }); // không khoá HMAC ⇒ từ chối
  });
});
