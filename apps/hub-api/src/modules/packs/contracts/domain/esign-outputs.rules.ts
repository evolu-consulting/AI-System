// CR-125 · m9 · đầu ra node Ký số (khai ở `@ai/contracts/modules` esign/node.ts): phong bì ở trạng thái cuối ⇒ dữ liệu kèm sự kiện
// `esign.*` cho bước chờ: `envelope_id` (mọi trạng thái cuối), `signed_at` + `signer` (chỉ khi ký xong). Luật thuần, lớp 1.
// `signed_at` giữ NGUYÊN mốc đầy đủ (ISO, UTC) của `completed_at` — KHÔNG cắt ngày ở đây (cắt theo UTC làm ký 00:00–07:00 giờ VN lệch một
// ngày). Ngày chỉ được định dạng theo giờ Việt Nam khi HIỂN THỊ (`viDayOf`, dùng ở mẫu thông báo).

import { isSigned } from "./esign-signer.rules";

type Signer = { name: string; email: string; signed_at: string | null; status?: string | null };
export type EnvelopeFacts = {
  envelopeId: string;
  status: string;
  completedAt: string | null;
  signers: readonly Signer[];
};

const SIGNER_MAX = 500;

/** Tên người đã ký (`isSigned`), theo thứ tự ký (cùng lúc / không có mốc ⇒ thứ tự danh sách); không ai đã ký mà phong bì xong ⇒ mọi người ký. */
function signerNames(signers: readonly Signer[]): string {
  const signed = signers
    .map((s, i) => ({ s, i, t: s.signed_at ? Date.parse(s.signed_at) : Number.POSITIVE_INFINITY }))
    .filter((x) => isSigned(x.s))
    .sort((a, b) => (a.t === b.t ? a.i - b.i : a.t - b.t))
    .map((x) => x.s);
  const list = signed.length > 0 ? signed : signers;
  return list
    .map((s) => s.name.trim() || s.email)
    .filter((n) => n !== "")
    .join(", ")
    .slice(0, SIGNER_MAX);
}

export function esignOutputsOf(e: EnvelopeFacts): Record<string, string> {
  const out: Record<string, string> = {};
  if (e.envelopeId) out.envelope_id = e.envelopeId;
  if (e.status !== "completed") return out;
  if (e.completedAt && Number.isFinite(Date.parse(e.completedAt))) out.signed_at = e.completedAt;
  const who = signerNames(e.signers);
  if (who) out.signer = who;
  return out;
}
