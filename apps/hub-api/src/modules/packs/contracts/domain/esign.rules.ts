// cf-esign-docusign · luật thuần ký số: map trạng thái envelope DocuSign, cấu hình env (thiếu ⇒ tắt), envelopeId từ webhook Connect,
// người ký mặc định, trang ký cuối tài liệu (esign-multi: HTML UTF-8 + anchor ẩn, thay PDF ASCII toạ độ cố định).
/** Trạng thái lưu của envelope (khớp `ESIGN_STATUSES` của contract + CHECK 0054). */
export type ESignStatus = "sent" | "delivered" | "completed" | "declined" | "voided";

export type ESignConfig = {
  integrationKey: string;
  userId: string;
  accountId: string;
  baseUri: string;
  oauthHost: string;
  privateKeyFile: string;
  hmacKey: string | null;
};

const MAP: Record<string, ESignStatus> = {
  created: "sent",
  sent: "sent",
  delivered: "delivered",
  signed: "delivered",
  correct: "sent",
  completed: "completed",
  declined: "declined",
  voided: "voided",
  deleted: "voided",
};

/** Trạng thái envelope của DocuSign ⇒ trạng thái lưu; lạ ⇒ null (giữ trạng thái cũ). */
export const mapEnvelopeStatus = (s: string | null | undefined): ESignStatus | null =>
  (s && MAP[s.toLowerCase()]) || null;

export const isOpen = (s: ESignStatus): boolean => s === "sent" || s === "delivered";

const v = (x: string | undefined) => (x && x.trim() !== "" ? x.trim() : null);

/** Env DocuSign ⇒ cấu hình; thiếu biến bắt buộc ⇒ null (tính năng tắt, UI báo "Chưa cấu hình ký số"). */
export function docusignConfigOf(env: Record<string, string | undefined>): ESignConfig | null {
  const integrationKey = v(env.DOCUSIGN_INTEGRATION_KEY);
  const userId = v(env.DOCUSIGN_USER_ID);
  const accountId = v(env.DOCUSIGN_ACCOUNT_ID);
  const privateKeyFile = v(env.DOCUSIGN_PRIVATE_KEY_FILE);
  if (!integrationKey || !userId || !accountId || !privateKeyFile) return null;
  return {
    integrationKey,
    userId,
    accountId,
    baseUri: (v(env.DOCUSIGN_BASE_URI) ?? "https://demo.docusign.net/restapi").replace(/\/+$/, ""),
    oauthHost: v(env.DOCUSIGN_OAUTH_HOST) ?? "account-d.docusign.com",
    privateKeyFile,
    hmacKey: v(env.DOCUSIGN_CONNECT_HMAC_KEY),
  };
}

const ENVELOPE_RE = /^[A-Za-z0-9-]{1,100}$/;

/** Chỉ lấy envelopeId từ thân Connect (JSON SIM: `data.envelopeId`; cũ: `envelopeId`) — mọi thứ khác không tin. */
export function envelopeIdOfWebhook(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { envelopeId?: unknown; data?: { envelopeId?: unknown } };
  const id = b.data?.envelopeId ?? b.envelopeId;
  return typeof id === "string" && ENVELOPE_RE.test(id) ? id : null;
}

export type SignerDefault = { role: "company" | "partner"; name: string; email: string };

/** Mặc định: đại diện bên mình = user hiện tại (ký trước), đối tác = liên hệ có email của đối tác trong HĐ. */
export function defaultSigners(o: {
  me: { name: string; email: string | null };
  partner: { name: string | null; email: string | null } | null;
}): SignerDefault[] {
  return [
    { role: "company", name: o.me.name, email: o.me.email ?? "" },
    { role: "partner", name: o.partner?.name ?? "", email: o.partner?.email ?? "" },
  ];
}

/** esign-multi · anchor ẩn (chữ trắng) trên trang ký HTML cho người ký thứ `i` (0-based) — DocuSign đặt ô ký/ngày theo chuỗi. */
export const signAnchors = (i: number) => ({ sign: `\\s${i + 1}\\`, date: `\\d${i + 1}\\` });

/** Độ lệch (pixel) của ô ký/ngày so với anchor — anchor nằm góc trên-trái trong khung `.slot` (96px) nên ô phải nằm DƯỚI anchor.
 *  Đo bằng `tools/scripts/src/esign-layout-check.ts` (phong bì nháp, không gửi email). */
export const SIGN_TAB_OFFSET = {
  sign: { x: "0", y: "32" },
  date: { x: "0", y: "8" },
} as const;

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

export type SignPageSigner = { role: "company" | "partner"; name: string; email: string };

/** esign-multi · trang ký cuối dạng HTML UTF-8 (DocuSign tự chuyển PDF, giữ dấu tiếng Việt): tiêu đề, tên + số HĐ, bảng người ký
 *  (Bên A = công ty, Bên B… = đối tác theo thứ tự), mỗi người một ô có anchor ẩn `\sN\` (chữ ký) và `\dN\` (ngày). Escape mọi trường. */
export function signaturePageHtml(o: {
  title: string;
  number: string | null;
  signers: SignPageSigner[];
}): string {
  let partner = 0;
  const party = (r: SignPageSigner["role"]) => {
    const l = r === "company" ? "A" : String.fromCharCode(66 + partner++);
    return `Bên ${l} / Party ${l}`;
  };
  const rows = o.signers
    .map((s, i) => {
      const a = signAnchors(i);
      return `<tr><td>${esc(party(s.role))}</td><td>${esc(s.name)}<br><small>${esc(s.email)}</small></td><td class="box"><div class="slot"><span class="a">${a.sign}</span></div></td><td class="date"><div class="slot"><span class="a">${a.date}</span></div></td></tr>`;
    })
    .join("");
  const num = o.number ? `<p>Số / No.: ${esc(o.number)}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12pt;margin:40px}h1{font-size:18pt;text-align:center}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #888;padding:8px;vertical-align:top}td.box{width:38%}td.date{width:20%}.slot{height:96px;position:relative}.a{position:absolute;top:6px;left:6px;color:#ffffff;font-size:8pt;line-height:1}</style></head><body><h1>TRANG KÝ / SIGNATURE PAGE</h1><p>Hợp đồng / Contract: <b>${esc(o.title)}</b></p>${num}<table><tr><th>Bên / Party</th><th>Người ký / Signer</th><th>Chữ ký / Signature</th><th>Ngày / Date</th></tr>${rows}</table></body></html>`;
}
