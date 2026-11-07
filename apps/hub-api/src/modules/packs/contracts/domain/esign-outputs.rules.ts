// CR-125 · m9 · đầu ra node Ký số (khai ở `@ai/contracts/modules` esign/node.ts): phong bì ở trạng thái cuối ⇒ dữ liệu kèm sự kiện
// `esign.*` cho bước chờ: `envelope_id` (mọi trạng thái cuối), `signed_at` + `signer` (chỉ khi ký xong). Luật thuần, lớp 1.
// `signed_at` kiểu `date` (YYYY-MM-DD, theo UTC của `completed_at`) để luật Nếu / Hẹn giờ / mẫu thông báo dùng được như ngày khác.

type Signer = { name: string; email: string; signed_at: string | null };
export type EnvelopeFacts = {
  envelopeId: string;
  status: string;
  completedAt: string | null;
  signers: readonly Signer[];
};

const SIGNER_MAX = 500;

/** Tên người đã ký, theo thứ tự ký (cùng lúc ⇒ thứ tự danh sách); không ai có mốc ký mà phong bì xong ⇒ mọi người ký. */
function signerNames(signers: readonly Signer[]): string {
  const signed = signers
    .map((s, i) => ({ s, i, t: s.signed_at ? Date.parse(s.signed_at) : Number.NaN }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.i - b.i)
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
  const day = e.completedAt?.slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) out.signed_at = day;
  const who = signerNames(e.signers);
  if (who) out.signer = who;
  return out;
}
