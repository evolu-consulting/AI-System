// CR-127 · P2b · BR-63/64 · spec §2.4, §3 #12–#14c: nối phong bì ký số ⇄ phiên ký chung (lớp 2, không SQL trực tiếp).
// (1) Phong bì của MỘT bên sang "completed" (webhook/làm mới/ký thử selfsign) ⇒ `markSigned` phiên gắn HĐ đó, kèm SHA-256 văn bản HĐ (hàm hub
//     so với bản đã thống nhất; cả hai ký ⇒ `done`, bộ chuyển hộp thư bắn `sign.session.signed|done` + chuyển HĐ hai bên).
// (2) Phiên kết thúc không ký (huỷ / từ chối / quá hạn đã chọn) ⇒ huỷ phong bì còn mở của HĐ bên đó (`voidForSession`, esign-void.ts).
// Lỗi nghiệp vụ phiên (`SESSION_*`) ⇒ cảnh báo, không làm hỏng luồng ký; lỗi khác ném tiếp.
import type { PackSystemUow } from "../../kit/public";
import { signSessionErrorOf } from "../domain/sign-session.rules";
import type { EnvelopeRow } from "./esign.ports";

/** Phần repo phiên ký mà use case cần (adapter: `sign-session.repo.ts`). */
export type SessionPort = {
  sessionOf(contractId: string): Promise<string | null>;
  mine(sessionId: string): Promise<{ status: string } | null>;
  markSigned(sessionId: string, signerName: string | null, pdfSha256: string): Promise<string>;
};
type Warn = (msg: string, meta: Record<string, unknown>) => void;

const ACTIVE = new Set(["accepted", "signing"]);

/** Tên người ký công ty trên phong bì (ưu tiên người đã ký); vắng ⇒ null (hàm hub giữ tên đã có). */
export function companySignerOf(e: EnvelopeRow | null): string | null {
  const company = e?.signers.filter((s) => s.role === "company") ?? [];
  return (company.find((s) => s.signed_at) ?? company[0])?.name ?? null;
}

export type SessionSignedDeps = {
  uow: PackSystemUow<{
    signSession: SessionPort;
    esign: { latest(contractId: string): Promise<EnvelopeRow | null> };
  }>;
  /** SHA-256 văn bản PDF của HĐ (bên mình); null ⇒ không đánh dấu (cảnh báo). */
  sha: (tenantId: string, contractId: string) => Promise<string | null>;
  warn: Warn;
};

/** Phong bì HĐ `contractId` vừa ký xong ⇒ đánh dấu bên mình đã ký trong phiên còn mở. Trả trạng thái phiên mới hoặc null (không phiên/bỏ qua). */
export function sessionSignedOnEnvelope(d: SessionSignedDeps) {
  return async (tenantId: string, contractId: string): Promise<string | null> => {
    const pre = await d.uow.system(tenantId, async (r) => {
      const sid = await r.signSession.sessionOf(contractId);
      const v = sid ? await r.signSession.mine(sid) : null;
      if (!sid || !v || !ACTIVE.has(v.status)) return null;
      return { sid, name: companySignerOf(await r.esign.latest(contractId)) };
    });
    if (!pre) return null;
    const sha = await d.sha(tenantId, contractId);
    if (!sha) {
      d.warn("sign-session-sha-missing", { contract_id: contractId });
      return null;
    }
    return d.uow
      .system(tenantId, (r) => r.signSession.markSigned(pre.sid, pre.name, sha))
      .catch((e: unknown) => {
        const code = signSessionErrorOf(e);
        if (!code) throw e;
        d.warn("sign-session-mark-failed", { contract_id: contractId, code });
        return null;
      });
  };
}
