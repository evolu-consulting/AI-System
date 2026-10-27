// cf-esign-docusign · DocuSign GIẢ trong bộ nhớ (test/demo khi chưa có tài khoản): cùng port `ESignProvider`; test điều khiển trạng thái
// (`complete`, `decline`). Server HTTP giả (int test) dựa trên kho này.
import type { ESignProvider, ESignRecipient } from "../application/esign.ports";
import { ESignProviderError } from "../application/esign.ports";

export type FakeEnvelope = {
  id: string;
  status: "sent" | "delivered" | "completed" | "declined" | "voided";
  subject: string;
  signers: (ESignRecipient & { status: string; signedAt: string | null })[];
  reason: string | null;
  completedAt: string | null;
  pdf: Uint8Array;
};

export type FakeESign = ESignProvider & {
  envelopes: Map<string, FakeEnvelope>;
  complete(id: string, at?: string): void;
  decline(id: string, reason: string): void;
};

export function fakeESign(): FakeESign {
  const envelopes = new Map<string, FakeEnvelope>();
  let n = 0;
  const get = (id: string) => {
    const e = envelopes.get(id);
    if (!e) throw new ESignProviderError("api 404 ENVELOPE_DOES_NOT_EXIST");
    return e;
  };
  return {
    key: "fake",
    demo: false,
    envelopes,
    async createEnvelope(i) {
      n += 1;
      const id = `fake-env-${n}-${crypto.randomUUID().slice(0, 8)}`;
      envelopes.set(id, {
        id,
        status: "sent",
        subject: i.subject,
        signers: i.signers.map((s) => ({ ...s, status: "sent", signedAt: null })),
        reason: null,
        completedAt: null,
        pdf: i.document.bytes,
      });
      return { envelopeId: id };
    },
    async getEnvelope(id) {
      const e = get(id);
      return {
        status: e.status,
        reason: e.reason,
        completedAt: e.completedAt,
        recipients: e.signers.map((s) => ({
          email: s.email,
          status: s.status,
          signedAt: s.signedAt,
        })),
      };
    },
    async recipientView(id, r, returnUrl) {
      const e = get(id);
      if (!e.signers.some((s) => s.clientUserId === r.clientUserId))
        throw new ESignProviderError("api 400 UNKNOWN_ENVELOPE_RECIPIENT");
      return `https://fake.docusign.test/signing/${id}?return=${encodeURIComponent(returnUrl)}`;
    },
    async combinedPdf(id) {
      const e = get(id);
      if (e.status !== "completed") throw new ESignProviderError("api 400 ENVELOPE_NOT_COMPLETE");
      return new TextEncoder().encode(`%PDF-1.4\n% signed ${id}\n%%EOF\n`);
    },
    async voidEnvelope(id, reason) {
      const e = get(id);
      e.status = "voided";
      e.reason = reason;
    },
    complete(id, at = "2026-10-27T03:00:00.000Z") {
      const e = get(id);
      e.status = "completed";
      e.completedAt = at;
      for (const s of e.signers) Object.assign(s, { status: "completed", signedAt: at });
    },
    decline(id, reason) {
      const e = get(id);
      e.status = "declined";
      e.reason = reason;
    },
  };
}
