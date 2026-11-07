// CR-125 · m4 · MOD-FR-11 · unit: người ký đổi cách ký KHÁC loại phong bì ⇒ huỷ phong bì cũ (không bắn tín hiệu) + gửi lại cùng người ký/thứ tự/hạn/nhắc.
import { describe, expect, it } from "bun:test";
import { ESignFail } from "./esign.helpers";
import type { EnvelopeRow, ESignProvider } from "./esign.ports";
import { esignSwitch } from "./esign-switch";

const signer = (role: "company" | "partner", order: number, signedAt: string | null = null) => ({
  role,
  name: role === "company" ? "Công ty" : "Đối tác",
  email: `${role}@x.vn`,
  order,
  client_user_id: role === "company" ? "u1" : null,
  status: null,
  signed_at: signedAt,
});
const env = (over: Partial<EnvelopeRow> = {}): EnvelopeRow => ({
  id: "e1",
  contractId: "c1",
  provider: "docusign",
  envelopeId: "env-1",
  status: "sent",
  signers: [signer("company", 1), signer("partner", 2)],
  reason: null,
  signedFileId: null,
  completedAt: null,
  createdAt: "",
  sentBy: "u1",
  dueH: 72,
  remindEveryH: 24,
  ...over,
});

function make(opts: { selfsign?: boolean } = {}) {
  const log: unknown[] = [];
  const voided: string[] = [];
  const adapter = (key: string) =>
    ({ key, voidEnvelope: async (id: string) => void voided.push(id) }) as unknown as ESignProvider;
  const sw = esignSwitch({
    uow: {
      tenant: async (_w: unknown, fn: (r: never) => unknown) =>
        fn({
          esign: { update: async (...a: unknown[]) => void log.push(["update", ...a]) },
        } as never),
    } as never,
    avail: (k) =>
      k === "docusign" || (k === "selfsign" && opts.selfsign !== false) ? adapter(k) : null,
    warn: undefined,
    send: async (...a) => void log.push(["send", ...a]),
    reopen: async () => env({ provider: "selfsign", envelopeId: "env-2" }),
    kindOf: (k) => (k === "selfsign" ? "ca" : "envelope"),
  });
  return { sw, log, voided };
}
const WHO = { tenantId: "t1", userId: "u1" };

describe("CR-125 m4 · đổi cách ký", () => {
  it("DocuSign ⇒ Ký thử: huỷ phong bì cũ, ghi voided, gửi lại cùng người ký/thứ tự/hạn/nhắc", async () => {
    const { sw, log, voided } = make();
    const out = (await sw(WHO, "c1", env(), "selfsign")).e;
    expect(voided).toEqual(["env-1"]);
    expect(log[0]).toMatchObject([
      "update",
      "env-1",
      { status: "voided", reason: "switch-provider" },
    ]);
    expect(log[1]).toEqual([
      "send",
      WHO,
      "c1",
      [{ role: "company" }, { role: "partner", name: "Đối tác", email: "partner@x.vn" }],
      "selfsign",
      { companyUsers: ["u1"], order: "sequential", dueH: 72, remindEveryH: 24 },
    ]);
    expect(out.envelopeId).toBe("env-2");
  });

  it("đã có người ký ⇒ không đổi (ESIGN_STATE); cách chưa bật ⇒ ESIGN_PROVIDER_UNAVAILABLE; không huỷ gì", async () => {
    const a = make();
    const signed = env({
      signers: [signer("company", 1, "2026-11-07T00:00:00Z"), signer("partner", 2)],
    });
    await expect(a.sw(WHO, "c1", signed, "selfsign")).rejects.toBeInstanceOf(ESignFail);
    const b = make({ selfsign: false });
    await expect(b.sw(WHO, "c1", env(), "selfsign")).rejects.toBeInstanceOf(ESignFail);
    expect(a.voided.concat(b.voided)).toEqual([]);
  });
});
