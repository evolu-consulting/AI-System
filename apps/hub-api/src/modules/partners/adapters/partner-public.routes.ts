// CR-124 · q5 · FLOW4-FR-12/13 · spec §8, §13 · trang công khai cho người liên hệ của công ty chưa dùng nền tảng (KHÔNG JWT; gắn trước auth ở `app.ts`):
//   GET  /partner-reply/:token       trang xem (bản chia sẻ + PDF + form)        POST /partner-reply/:token      trả lời (form, CSRF kép + Sec-Fetch-Site)
//   GET  /partner-reply/:token/pdf   PDF của đúng hợp đồng này (FileBox qua cổng gói)
// An ninh: token 256-bit chỉ lưu BĂM; tra bằng băm (so khớp chỉ số DB, không lộ thời gian có ích — băm không đảo được); link sai/hết hạn xa ⇒ cùng một trang;
// hạn mức theo IP + theo token (Redis, `window-limit.ts`); log request giấu token (`app.ts › redactPath`); `Cache-Control: no-store`, `noindex`, CSP chặt
// (không script), `Referrer-Policy: no-referrer`. Trả lời ghi qua `hub.partner_email_reply` — CÙNG `partner_reply_apply` với đường nền tảng/thủ công.
import { timingSafeEqual } from "node:crypto";
import { forwardedIp } from "@ai/contracts/client-ip";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import type { Logger } from "../../../lib/logger";
import type { PartnerMailboxPort } from "../../packs/kit/public";
import {
  EMAIL_LIMITS,
  type FormProblem,
  hashHex,
  ipPrefix,
  PROBLEM_TEXT,
  parseReplyForm,
  sha256Hex,
  TOKEN_RE,
} from "../domain/email-link.rules";
import type { PublicStore } from "../domain/email-view.types";
import {
  endedPage,
  invalidPage,
  limitedPage,
  messagePage,
  openPage,
  repliedPage,
} from "./public-page.view";
import type { WindowLimit } from "./window-limit";

const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const PDF_CSP = "default-src 'none'; frame-ancestors 'self'";

export type PartnerPublicDeps = {
  store: PublicStore;
  limit: WindowLimit;
  port: () => PartnerMailboxPort | undefined;
  log: Logger;
  /** Số proxy tin cậy trước hub-api (`TRUST_PROXY_HOPS`); 0 ⇒ IP socket. */
  hops: number;
};

type Ctx = Context;

function harden(c: Ctx, csp: string): void {
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", csp);
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

const html = (c: Ctx, body: string, status: 200 | 303 | 403 | 404 | 410 | 422 | 429 = 200) => {
  harden(c, PAGE_CSP);
  return c.html(body, status);
};

/** IP client: có `hops` proxy tin cậy ⇒ phần tử thứ `hops` từ cuối của X-Forwarded-For (dùng chung với admin-api); không ⇒ IP socket. Không đọc được ⇒ null. */
function ipOf(c: Ctx, hops: number): string | null {
  if (hops > 0) {
    const ip = forwardedIp(c.req.header("x-forwarded-for"), hops);
    return ip && ip.length <= 64 ? ip : null;
  }
  try {
    const srv = c.env as { requestIP?: (r: Request) => { address?: string } | null } | undefined;
    return srv?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}

/** Cùng nguồn gốc? `Sec-Fetch-Site` (trình duyệt hiện đại) → `Origin` so với `Host` (KHÔNG tin X-Forwarded-Host) → không tín hiệu ⇒ dựa vào cookie CSRF. */
export function sameSiteRequest(h: { get(n: string): string | null | undefined }): boolean {
  const sfs = h.get("sec-fetch-site");
  if (sfs) return sfs === "same-origin" || sfs === "none";
  const origin = h.get("origin");
  if (!origin) return true;
  try {
    const host = (h.get("host") ?? "").trim();
    return new URL(origin).hostname === host.replace(/:\d+$/, "");
  } catch {
    return false;
  }
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

type Gate = { ok: true; ip: string | null; th: string } | { ok: false; res: Response };

/** Cổng chung: hạn mức IP → khoá IP đoán link sai → dạng token → hạn mức token. */
async function gate(c: Ctx, d: PartnerPublicDeps, kind: "open" | "pdf" | "reply"): Promise<Gate> {
  const token = c.req.param("token") ?? "";
  const ip = ipOf(c, d.hops);
  const key = ip ?? "unknown";
  const tooMany = (retry: number): Gate => {
    c.header("Retry-After", String(retry));
    return { ok: false, res: html(c, limitedPage(retry), 429) };
  };
  const byIp = await d.limit.hit(`ip:${key}`, EMAIL_LIMITS.perIpMinute, 60);
  if (!byIp.ok) return tooMany(byIp.retryAfterS);
  if ((await d.limit.count(`bad:${key}`, 600)) >= EMAIL_LIMITS.badTokenPerIp10Min)
    return tooMany(60);
  if (!TOKEN_RE.test(token)) return { ok: false, res: await invalid(c, d, key) };
  const th = await hashHex(token);
  const lim =
    kind === "open"
      ? EMAIL_LIMITS.openPerTokenHour
      : kind === "pdf"
        ? EMAIL_LIMITS.pdfPerTokenHour
        : EMAIL_LIMITS.replyPerTokenHour;
  const byToken = await d.limit.hit(`${kind}:${th}`, lim, 3600);
  if (!byToken.ok) return tooMany(byToken.retryAfterS);
  return { ok: true, ip, th };
}

async function invalid(c: Ctx, d: PartnerPublicDeps, key: string): Promise<Response> {
  await d.limit.hit(`bad:${key}`, EMAIL_LIMITS.badTokenPerIp10Min, 600);
  return html(c, invalidPage(), 404);
}

const cookieName = "prc";
const cookiePath = (token: string) => `/partner-reply/${token}`;

/** Form sai ⇒ vẽ lại trang với lý do (422), giữ giá trị đã nhập. */
async function formError(
  c: Ctx,
  d: PartnerPublicDeps,
  g: { ip: string | null; th: string },
  body: Record<string, unknown>,
  problem: FormProblem,
  csrf: string,
): Promise<Response> {
  const token = c.req.param("token") ?? "";
  const v = await d.store.view(g.th, { ip: null, ua: null, audit: false });
  if (!v) return invalid(c, d, g.ip ?? "unknown");
  if (v.state !== "open") return c.redirect(`/partner-reply/${token}`, 303);
  const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
  return html(
    c,
    openPage(v, {
      token,
      csrf,
      error: PROBLEM_TEXT[problem],
      values: { name: str("name"), title: str("title"), reason: str("reason") },
    }),
    422,
  );
}

/** POST trả lời: hạn mức → CSRF kép + cùng nguồn → kiểm form → MỘT lời gọi `hub.partner_email_reply` → PRG về trang GET. */
async function replyRoute(c: Ctx, d: PartnerPublicDeps): Promise<Response> {
  const g = await gate(c, d, "reply");
  if (!g.ok) return g.res;
  const token = c.req.param("token") ?? "";
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const csrfCookie = getCookie(c, cookieName) ?? "";
  const csrfForm = typeof body.csrf === "string" ? body.csrf : "";
  if (!sameSiteRequest(c.req.raw.headers) || !csrfCookie || !safeEq(csrfCookie, csrfForm))
    return html(
      c,
      messagePage("Phiên trả lời đã hết hạn", "Vui lòng mở lại link trong email rồi trả lời lại."),
      403,
    );
  const parsed = parseReplyForm(body);
  if (!parsed.ok) return formError(c, d, g, body, parsed.problem, csrfCookie);
  const code = await d.store.reply(g.th, parsed.form, {
    ip: ipPrefix(g.ip),
    ua: c.req.header("user-agent") ?? null,
  });
  if (code === "invalid") return invalid(c, d, g.ip ?? "unknown");
  harden(c, PAGE_CSP);
  return c.redirect(`/partner-reply/${token}`, 303); // ok/same/conflict/closed/expired: trang GET hiện đúng trạng thái đã ghi
}

export function partnerPublicRoutes(d: PartnerPublicDeps): Hono {
  const r = new Hono();

  r.get("/:token", async (c) => {
    const g = await gate(c, d, "open");
    if (!g.ok) return g.res;
    const token = c.req.param("token");
    const ua = c.req.header("user-agent") ?? null;
    const v = await d.store.view(g.th, { ip: ipPrefix(g.ip), ua, audit: true });
    if (!v) return invalid(c, d, g.ip ?? "unknown");
    if (v.state === "expired" || v.state === "closed") return html(c, endedPage(v), 410);
    if (v.state === "replied") return html(c, repliedPage(v, token));
    const csrf = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
    setCookie(c, cookieName, csrf, {
      httpOnly: true,
      sameSite: "Strict",
      path: cookiePath(token),
      maxAge: 3600,
      secure: c.req.header("x-forwarded-proto") === "https",
    });
    return html(c, openPage(v, { token, csrf }));
  });

  r.get("/:token/pdf", async (c) => {
    const g = await gate(c, d, "pdf");
    if (!g.ok) return g.res;
    const v = await d.store.view(g.th, { ip: null, ua: null, audit: false });
    if (!v) return invalid(c, d, g.ip ?? "unknown");
    const pdf =
      (v.state === "open" || v.state === "replied") && v.file_ref
        ? await d.port()?.pdf?.(v.from_tenant, v.file_ref)
        : null;
    // Tệp đã đổi so với bản chụp lúc gửi ⇒ không phát (bên nhận chỉ xem đúng bản đã gửi).
    if (!pdf || (v.pdf_sha256 && (await sha256Hex(pdf.bytes)) !== v.pdf_sha256))
      return html(
        c,
        messagePage("Không mở được bản PDF", "Vui lòng liên hệ công ty đã gửi hợp đồng."),
        404,
      );
    harden(c, PDF_CSP);
    c.header("Content-Type", "application/pdf");
    c.header("Content-Disposition", 'inline; filename="hop-dong.pdf"');
    return c.body(pdf.bytes as Uint8Array<ArrayBuffer>);
  });

  r.post(
    "/:token",
    bodyLimit({ maxSize: 16 * 1024, onError: (c) => html(c, invalidPage(), 404) }),
    (c) => replyRoute(c, d),
  );

  return r;
}
