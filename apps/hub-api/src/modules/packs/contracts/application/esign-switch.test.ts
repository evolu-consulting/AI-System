// CR-125 · m4 · MOD-FR-11 · unit: người ký đổi cách ký KHÁC loại phong bì ⇒ giành quyền (khoá + lease) ⇒ huỷ ở nhà cung cấp (hụt ⇒ dừng, phong bì
// cũ sống) ⇒ voided + audit ⇒ gửi lại cùng người ký/thứ tự/HẠN CÒN LẠI/nhắc; gửi lại + dựng lại cùng hụt ⇒ bắn voided cho lượt.
import { describe, expect, it } from "bun:test";
import { ESignFail } from "./esign.helpers";
import type { EnvelopeRow, ESignProvider } from "./esign.ports";
import { esignSwitch, remainingDueH } from "./esign-switch";

const NOW = new Date("2026-11-07T12:00:00.000Z");
const H = 3_600_000;
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
  createdAt: new Date(NOW.getTime() - 24 * H).toISOString(),
  sentBy: "u1",
  dueH: 72,
  remindEveryH: 24,
  ...over,
});

type Opts = {
  selfsign?: boolean;
  failSend?: "new" | "both";
  failVoid?: boolean;
  claimed?: boolean;
  row?: EnvelopeRow;
};
function make(opts: Opts = {}) {
  const log: unknown[][] = [];
  const voided: string[] = [];
  const events: string[] = [];
  const adapter = (key: string) =>
    ({
      key,
      voidEnvelope: async (id: string) => {
        if (opts.failVoid) throw new Error("void-down");
        voided.push(id);
      },
    }) as unknown as ESignProvider;
  const rec =
    (name: string, ret: unknown = undefined) =>
    async (...a: unknown[]) => {
      log.push([name, ...a]);
      return ret;
    };
  const row = opts.row ?? env();
  const sw = esignSwitch({
    uow: {
      tenant: async (_w: unknown, fn: (r: never) => unknown) =>
        fn({
          esign: {
            lockById: rec("lock", row),
            claimSwitch: rec("claim", opts.claimed ? null : row),
            releaseSwitch: rec("release"),
            voidClaimed: rec("voidClaimed", true),
            audit: rec("audit"),
            update: rec("update"),
          },
        } as never),
    } as never,
    avail: (k) =>
      k === "docusign" || (k === "selfsign" && opts.selfsign !== false) ? adapter(k) : null,
    warn: undefined,
    send: async (...a) => {
      log.push(["send", ...a]);
      if (opts.failSend === "both" || (opts.failSend === "new" && a[3] === "selfsign"))
        throw new Error("boom");
    },
    reopen: async () => env({ provider: "selfsign", envelopeId: "env-2" }),
    kindOf: (k) => (k === "selfsign" ? "ca" : "envelope"),
    now: () => NOW,
    onStatus: async (_t, _c, st) => void events.push(st),
  });
  const of = (n: string) => log.filter((l) => l[0] === n);
  return { sw, log, voided, events, of };
}
const WHO = { tenantId: "t1", userId: "u1" };
const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (x: unknown) => (x instanceof ESignFail ? `${x.code}` : String(x)),
  );

describe("CR-125 m4 · đổi cách ký", () => {
  it("DocuSign ⇒ Ký thử: khoá + giành quyền, huỷ, voided + audit, gửi lại với hạn CÒN LẠI", async () => {
    const { sw, log, voided, of } = make();
    const out = (await sw(WHO, "c1", env(), "selfsign")).e;
    expect(voided).toEqual(["env-1"]);
    expect(log.map((l) => l[0])).toEqual(["lock", "claim", "voidClaimed", "audit", "send"]);
    expect(of("voidClaimed")[0]).toEqual(["voidClaimed", "e1", "switch-provider"]);
    expect(of("audit")[0]).toEqual([
      "audit",
      "u1",
      { esign_switch: { contract_id: "c1", provider: "docusign", envelope_id: "env-1" } },
      { esign_switch: { contract_id: "c1", provider: "selfsign" } },
    ]);
    expect(of("send")[0]).toEqual([
      "send",
      WHO,
      "c1",
      [{ role: "company" }, { role: "partner", name: "Đối tác", email: "partner@x.vn" }],
      "selfsign",
      { companyUsers: ["u1"], order: "sequential", dueH: 48, remindEveryH: 24 },
    ]);
    expect(out.envelopeId).toBe("env-2");
  });

  it("hạn còn lại: làm tròn lên, tối thiểu 1 giờ; không hạn ⇒ null", () => {
    const at = (agoH: number) => new Date(NOW.getTime() - agoH * H).toISOString();
    expect(remainingDueH({ createdAt: at(10.5), dueH: 72 }, NOW)).toBe(62);
    expect(remainingDueH({ createdAt: at(100), dueH: 72 }, NOW)).toBe(1);
    expect(remainingDueH({ createdAt: at(1), dueH: null }, NOW)).toBeNull();
  });

  it("đã có người ký (theo hàng khoá) ⇒ ESIGN_STATE; cách chưa bật ⇒ ESIGN_PROVIDER_UNAVAILABLE; không huỷ gì", async () => {
    const signed = env({
      signers: [signer("company", 1, "2026-11-07T00:00:00Z"), signer("partner", 2)],
    });
    const a = make({ row: signed });
    expect(await codeOf(a.sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_STATE");
    const b = make({ selfsign: false });
    expect(await codeOf(b.sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_PROVIDER_UNAVAILABLE");
    expect(a.voided.concat(b.voided)).toEqual([]);
    expect(a.of("claim")).toEqual([]);
  });

  it("lượt khác đang đổi / đã đổi ⇒ ESIGN_STATE, không gọi nhà cung cấp, không gửi", async () => {
    const a = make({ claimed: true });
    expect(await codeOf(a.sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_STATE");
    const b = make({ row: env({ status: "voided" }) });
    expect(await codeOf(b.sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_STATE");
    expect(a.voided.concat(b.voided)).toEqual([]);
    expect(a.of("send").concat(b.of("send"))).toEqual([]);
  });

  it("huỷ ở nhà cung cấp hụt ⇒ ESIGN_RESEND_FAILED, nhả quyền, hàng cũ không đổi, không gửi", async () => {
    const { sw, log } = make({ failVoid: true });
    expect(await codeOf(sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_RESEND_FAILED");
    expect(log.map((l) => l[0])).toEqual(["lock", "claim", "release"]);
  });

  it("gửi lại hụt ⇒ dựng lại trên cách đã gửi + ESIGN_RESEND_FAILED; lượt vẫn chờ", async () => {
    const { sw, of, events } = make({ failSend: "new" });
    expect(await codeOf(sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_RESEND_FAILED");
    expect(of("send").map((s) => s[4])).toEqual(["selfsign", "docusign"]);
    expect(events).toEqual([]);
  });

  it("gửi lại + dựng lại cùng hụt ⇒ ghi lý do resend-failed + bắn voided cho lượt (rời bước chờ)", async () => {
    const { sw, of, events } = make({ failSend: "both" });
    expect(await codeOf(sw(WHO, "c1", env(), "selfsign"))).toBe("ESIGN_RESEND_FAILED");
    expect(of("update")[0]).toMatchObject([
      "update",
      "env-1",
      { status: "voided", reason: "resend-failed" },
    ]);
    expect(events).toEqual(["voided"]);
  });
});
