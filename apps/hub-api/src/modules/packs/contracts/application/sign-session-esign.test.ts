// CR-127 · P2b · luật nối phong bì ⇄ phiên ký chung: tên người ký công ty; huỷ phong bì khi phiên kết thúc không ký (OK ⇒ voided,
// hụt ⇒ giữ mở + VOID_PENDING để làm mới thử lại).
import { describe, expect, it } from "bun:test";
import type { EnvelopeRow, ESignProvider, ESignRepo, StoredSigner } from "./esign.ports";
import { SESSION_ENDED, VOID_PENDING, voidForSession } from "./esign-void";
import { companySignerOf } from "./sign-session-esign";

const signer = (role: "company" | "partner", name: string, at: string | null): StoredSigner => ({
  role,
  name,
  email: `${name}@x.vn`,
  order: 1,
  client_user_id: null,
  status: null,
  signed_at: at,
});
const env = (signers: StoredSigner[]): EnvelopeRow =>
  ({
    id: "e1",
    contractId: "c1",
    provider: "selfsign",
    envelopeId: "env-1",
    status: "sent",
    signers,
    reason: null,
    signedFileId: null,
    completedAt: null,
    createdAt: "2026-11-10T00:00:00Z",
  }) as EnvelopeRow;

describe("CR-127 P2b · companySignerOf", () => {
  it("ưu tiên người ký công ty đã ký; không phong bì ⇒ null", () => {
    expect(companySignerOf(null)).toBeNull();
    expect(
      companySignerOf(
        env([
          signer("partner", "P", "t"),
          signer("company", "C1", null),
          signer("company", "C2", "t"),
        ]),
      ),
    ).toBe("C2");
    expect(companySignerOf(env([signer("company", "C1", null)]))).toBe("C1");
  });
});

describe("CR-127 P2b · voidForSession", () => {
  const run = (patches: unknown[]) => (fn: (r: { esign: ESignRepo }) => Promise<unknown>) =>
    fn({
      esign: { update: async (_id: string, p: unknown) => void patches.push(p) } as ESignRepo,
    }) as never;
  const prov = (fail: boolean): ESignProvider =>
    ({
      voidEnvelope: async () => {
        if (fail) throw new Error("x");
      },
    }) as unknown as ESignProvider;

  it("huỷ ở nhà cung cấp OK ⇒ voided + reason sign-session-ended", async () => {
    const patches: unknown[] = [];
    expect(await voidForSession(undefined)(prov(false), env([]), run(patches))).toBe(true);
    expect(patches[0]).toMatchObject({ status: "voided", reason: SESSION_ENDED });
  });

  it("hụt / không nhà cung cấp ⇒ giữ trạng thái + VOID_PENDING + cảnh báo", async () => {
    const patches: unknown[] = [];
    const warns: string[] = [];
    const w = (m: string) => void warns.push(m);
    expect(await voidForSession(w)(prov(true), env([]), run(patches))).toBe(false);
    expect(await voidForSession(w)(null, env([]), run(patches))).toBe(false);
    expect(patches).toEqual([
      expect.objectContaining({ status: "sent", reason: VOID_PENDING }),
      expect.objectContaining({ status: "sent", reason: VOID_PENDING }),
    ]);
    expect(warns).toEqual(["esign-session-void-failed", "esign-session-void-failed"]);
  });
});
