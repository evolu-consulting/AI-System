// CR-125 · x12 · luật thuần (lớp 1) dựng email "Mời ký" từ dữ liệu có cấu trúc của thông báo (`hub.notifications.data`): thẻ tóm tắt hợp đồng + ảnh
// trang đầu (nhúng CID) + MỘT nút "Xem hợp đồng và ký". Bảo mật: KHÔNG đính PDF, KHÔNG điều khoản — chỉ các trường thẻ và ảnh trang 1; không token trong thư
// (liên kết là đường dẫn trong app, đăng nhập mới xem được). Không I/O. Cùng kiểu thư với đường email đối tác (q5): thẻ trắng, nút xanh, ≤ 560 px, đọc được trên điện thoại.

export const SIGN_INVITE_KIND = "contract.esign";
export const THUMB_CID = "contract-page1";

export type SignInviteData = {
  type: "esign_invite";
  contract: {
    title: string;
    number?: string | null;
    partner?: string | null;
    value?: number | null;
    start?: string | null;
    end?: string | null;
  };
  requested_by?: { name?: string | null; company?: string | null } | null;
  requested_at?: string | null;
  deadline?: string | null;
  thumb?: { b64: string; width: number; height: number } | null;
};

export type InviteMail = {
  subject: string;
  text: string;
  html: string;
  inline: { cid: string; contentType: string; base64: string }[];
};

const str = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;

/** Đọc dữ liệu thông báo một cách phòng thủ (jsonb do gói ghi): sai dạng ⇒ null ⇒ dùng thư văn bản thường. */
export function parseInviteData(raw: unknown): SignInviteData | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (d.type !== "esign_invite") return null;
  const c = (d.contract ?? {}) as Record<string, unknown>;
  const title = str(c.title, 200);
  if (!title) return null;
  const by = (d.requested_by ?? {}) as Record<string, unknown>;
  const th = (d.thumb ?? null) as Record<string, unknown> | null;
  const b64 = th && typeof th.b64 === "string" && /^[A-Za-z0-9+/=]+$/.test(th.b64) ? th.b64 : null;
  return {
    type: "esign_invite",
    contract: {
      title,
      number: str(c.number, 80),
      partner: str(c.partner, 200),
      value: typeof c.value === "number" && Number.isFinite(c.value) ? c.value : null,
      start: str(c.start, 10),
      end: str(c.end, 10),
    },
    requested_by: { name: str(by.name, 120), company: str(by.company, 200) },
    requested_at: str(d.requested_at, 40),
    deadline: str(d.deadline, 40),
    thumb:
      b64 && b64.length <= 160_000
        ? { b64, width: Number(th?.width) || 560, height: Number(th?.height) || 740 }
        : null,
  };
}

type Loc = "vi" | "en";
type Strings = {
  hello: string;
  intro: string;
  kicker: string;
  contract: string;
  partner: string;
  value: string;
  effective: string;
  requested: string;
  deadline: string;
  cta: string;
  thumb: string;
  thumbAlt: string;
  safe: string;
  from: string;
  via: string;
  on: string;
  to: string;
  from2: string;
  subjectPre: string;
};
const T: Record<Loc, Strings> = {
  vi: {
    hello: "Kính gửi",
    intro: "Hợp đồng đã được duyệt xong và đang chờ bạn ký.",
    kicker: "Mời ký hợp đồng",
    contract: "Hợp đồng",
    partner: "Đối tác",
    value: "Giá trị",
    effective: "Hiệu lực",
    requested: "Người yêu cầu",
    deadline: "Hạn ký",
    cta: "Xem hợp đồng và ký",
    thumb: "Trang đầu của hợp đồng (chỉ để xem nhanh)",
    thumbAlt: "Trang đầu của hợp đồng",
    safe: "Thư này không kèm hợp đồng. Bạn cần đăng nhập để xem đầy đủ và ký.",
    from: "Thư gửi bởi",
    via: "qua hệ thống",
    on: "ngày",
    to: "đến",
    from2: "từ",
    subjectPre: "Mời ký",
  },
  en: {
    hello: "Dear",
    intro: "The contract has been approved and is waiting for your signature.",
    kicker: "Contract signing request",
    contract: "Contract",
    partner: "Counterparty",
    value: "Value",
    effective: "Effective",
    requested: "Requested by",
    deadline: "Sign by",
    cta: "View contract and sign",
    thumb: "First page of the contract (quick preview only)",
    thumbAlt: "First page of the contract",
    safe: "This email does not include the contract. Sign in to view it in full and sign.",
    from: "Sent by",
    via: "via the platform",
    on: "on",
    to: "to",
    from2: "from",
    subjectPre: "Please sign",
  },
};

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const oneLine = (s: string, n: number): string =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, n);

/** dd/mm/yyyy theo giờ Việt Nam; không đọc được ⇒ null. */
export function vnDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00+07:00` : iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

const money = (v: number): string => `${v.toLocaleString("vi-VN")} đ`;

type Row = { label: string; value: string };
function rowsOf(d: SignInviteData, l: Strings): Row[] {
  const c = d.contract;
  const rows: Row[] = [
    { label: l.contract, value: c.number ? `${c.title} · ${c.number}` : c.title },
  ];
  if (c.partner) rows.push({ label: l.partner, value: c.partner });
  if (typeof c.value === "number") rows.push({ label: l.value, value: money(c.value) });
  const eff = effectiveOf(c, l);
  if (eff) rows.push({ label: l.effective, value: eff });
  const who = d.requested_by?.name;
  if (who) {
    const at = vnDay(d.requested_at);
    rows.push({ label: l.requested, value: at ? `${who} · ${at}` : who });
  }
  const dl = vnDay(d.deadline);
  if (dl) rows.push({ label: l.deadline, value: dl });
  return rows;
}

/** Dòng "Hiệu lực": đủ hai đầu ⇒ `a – b`; một đầu ⇒ chỉ đầu đó. */
function effectiveOf(c: SignInviteData["contract"], l: Strings): string | null {
  const s = vnDay(c.start);
  const e = vnDay(c.end);
  if (s && e) return `${s} – ${e}`;
  if (s) return `${l.from2} ${s}`;
  return e ? `${l.to} ${e}` : null;
}

export function subjectOf(d: SignInviteData, loc: Loc): string {
  const pre = T[loc].subjectPre;
  const base = d.contract.partner
    ? `${d.contract.title} · ${d.contract.partner}`
    : d.contract.title;
  return oneLine(`${pre}: ${base}`, 200);
}

/** "Nguyễn Văn An (Công ty X)" / chỉ công ty / null. */
function senderOf(d: SignInviteData): string | null {
  const by = d.requested_by;
  if (by?.name) return by.company ? `${by.name} (${by.company})` : by.name;
  return by?.company ?? null;
}

const e0 = escapeHtml;
const rowsHtml = (rows: readonly Row[]): string =>
  rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 0;width:34%;font-size:13px;color:#5b6675;vertical-align:top">${e0(r.label)}</td><td style="padding:6px 0;font-size:14px;color:#1b2430;font-weight:600;vertical-align:top">${e0(r.value)}</td></tr>`,
    )
    .join("");

function thumbHtml(t: SignInviteData["thumb"], l: Strings): string {
  if (!t) return "";
  return `<tr><td style="padding:16px 24px 0"><div style="font-size:12px;color:#5b6675;margin-bottom:6px">${e0(l.thumb)}</div><img src="cid:${THUMB_CID}" alt="${e0(l.thumbAlt)}" width="${Math.min(512, t.width)}" style="display:block;width:100%;max-width:512px;height:auto;border:1px solid #dde3ea;border-radius:6px"></td></tr>`;
}

export function buildSignInviteMail(i: {
  data: SignInviteData;
  link: string;
  toName: string;
  locale: Loc;
}): InviteMail {
  const l = T[i.locale];
  const d = i.data;
  const rows = rowsOf(d, l);
  const sender = senderOf(d);
  const hello = `${l.hello} ${oneLine(i.toName, 120) || ""}`.trim();
  const text = [
    `${hello},`,
    "",
    l.intro,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    `${l.cta}: ${i.link}`,
    "",
    l.safe,
    ...(sender ? [`${l.from} ${sender} ${l.via}.`] : []),
  ].join("\n");
  const e = escapeHtml;
  const tr = rowsHtml(rows);
  const thumb = thumbHtml(d.thumb, l);
  const html = `<!doctype html><html lang="${i.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head><body style="margin:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;color:#1b2430">
<div style="display:none;max-height:0;overflow:hidden">${e(l.intro)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde3ea;border-radius:10px">
<tr><td style="padding:22px 24px 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#5b6675">${e(l.kicker)}</td></tr>
<tr><td style="padding:0 24px;font-size:20px;line-height:1.35;font-weight:600">${e(d.contract.title)}</td></tr>
<tr><td style="padding:10px 24px 0;font-size:15px;line-height:1.5">${e(hello)},<br>${e(l.intro)}</td></tr>
<tr><td style="padding:14px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f9fb;border:1px solid #e6ebf0;border-radius:8px"><tr><td style="padding:8px 14px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${tr}</table></td></tr></table></td></tr>
${thumb}
<tr><td style="padding:20px 24px 6px"><a href="${e(i.link)}" style="display:block;text-align:center;background:#1f5fbf;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 22px;border-radius:8px">${e(l.cta)}</a></td></tr>
<tr><td style="padding:8px 24px 0;font-size:12px;line-height:1.5;color:#5b6675">${e(l.safe)}</td></tr>
<tr><td style="padding:6px 24px 22px;font-size:12px;line-height:1.5;color:#5b6675">${sender ? `${e(l.from)} ${e(sender)} ${e(l.via)}.` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  return {
    subject: subjectOf(d, i.locale),
    text,
    html,
    inline: d.thumb ? [{ cid: THUMB_CID, contentType: "image/jpeg", base64: d.thumb.b64 }] : [],
  };
}
