// cf-esign-docusign · luật thuần ký số: map trạng thái envelope DocuSign, cấu hình env (thiếu ⇒ tắt), envelopeId từ webhook Connect,
// người ký mặc định, trang ký cuối tài liệu (PDF một trang tự sinh, chữ ASCII, toạ độ ô ký cố định).
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

export type ESignKind = "none" | "selfsign" | "docusign";

/** `ESIGN_PROVIDER` (none | selfsign | docusign), mặc định / lạ ⇒ none (tắt). */
export function esignKindOf(env: Record<string, string | undefined>): ESignKind {
  const k = v(env.ESIGN_PROVIDER)?.toLowerCase();
  return k === "selfsign" || k === "docusign" ? k : "none";
}

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

/** Toạ độ ô ký (điểm PDF, gốc trên-trái theo DocuSign) trên trang ký cuối cho người ký thứ `i`. */
export const signTabAt = (i: number) => ({ x: 72, y: 170 + i * 120 });

const ascii = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[()\\]/g, " ")
    .slice(0, 80);

/** PDF A4 một trang "SIGNATURES" (Helvetica, ASCII) nối cuối envelope để đặt ô ký — không phụ thuộc số trang HĐ gốc. */
export function signaturePagePdf(title: string): Uint8Array {
  const text = `BT /F1 16 Tf 72 780 Td (SIGNATURES / CHU KY) Tj 0 -24 Td /F1 10 Tf (${ascii(title)}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
