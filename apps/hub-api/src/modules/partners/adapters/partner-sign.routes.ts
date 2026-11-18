// CR-182 · đợt 2 · trang công khai «Đối tác ký qua link riêng» (BR-C5) — KHÔNG JWT, gắn TRƯỚC auth (cùng khuôn `partner-public.routes.ts`, CR-124/150):
//   GET  /sign-link/:token                          thông tin (công ty A, HĐ, tệp được gửi, chỗ ký Bên B, trạng thái) + `csrf`
//   GET  /sign-link/:token/files/:fileId            PDF bản mới nhất của tệp được gửi
//   GET  /sign-link/:token/versions/:fileId/:vid    PDF một bản đã ký (chưa huỷ)
//   POST /sign-link/:token/quick-signature          {method, png(base64)}  — PNG kiểm magic + IHDR + cỡ (như `signature.rules.checkPng`)
//   POST /sign-link/:token/sign                     {file_id, marks[]}     — KHÔNG nhận ảnh (strict ⇒ 400); máy chủ in chữ ký nhanh của link
//   POST /sign-link/:token/decline                  {reason}
// An ninh như CR-150: token 256-bit chỉ lưu BĂM; hạn mức theo IP + theo token (`window-limit.ts`, 429 + Retry-After); POST cần CSRF kép (cookie `psc`
// path riêng của token = header `x-sign-csrf`; giá trị trả trong thân GET) + cùng nguồn; link sai ⇒ 404 cùng thân, hết hạn/thu hồi ⇒ 410; lỗi chỉ có mã + câu chung.
import {
  PartnerDeclineBodySchema,
  PartnerQuickSignatureBodySchema,
  PartnerSignBodySchema,
} from "@ai/contracts/pack-contracts";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import type { PartnerSignPublicPort, SignLinkResult } from "../../packs/kit/public";
import { checkPng } from "../../signatures/public";
import { EMAIL_LIMITS, hashHex, TOKEN_RE } from "../domain/email-link.rules";
import { harden, ipOf, safeEq, sameSiteRequest } from "./partner-public.routes";
import type { WindowLimit } from "./window-limit";

export const SIGN_LINK_PUBLIC_PATH = "/sign-link";
const COOKIE = "psc";
const MSG: Record<number, string> = {
  400: "Yêu cầu không hợp lệ",
  403: "Không được phép",
  404: "Không tìm thấy",
  409: "Link ký này đã dùng xong",
  410: "Link ký đã hết hạn hoặc đã bị thu hồi",
  413: "Dữ liệu quá lớn",
  422: "Dữ liệu không hợp lệ",
  429: "Quá nhiều yêu cầu, vui lòng thử lại sau",
};
const JSON_CSP = "default-src 'none'; frame-ancestors 'none'";
const PDF_CSP = "default-src 'none'; frame-ancestors 'self'";
const uuid = z.uuid();
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

export type PartnerSignRoutesDeps = {
  port: () => PartnerSignPublicPort | undefined;
  limit: WindowLimit;
  hops: number;
};
type Ctx = Context;
type Kind = "open" | "pdf" | "write";

function err(
  c: Ctx,
  status: 400 | 403 | 404 | 409 | 410 | 413 | 422 | 429,
  code: string,
): Response {
  harden(c, JSON_CSP);
  return c.json({ error: { code, message: MSG[status] ?? "Lỗi" } }, status);
}
const out = <T>(c: Ctx, r: SignLinkResult<T>, okStatus: 200 | 201 = 200): Response =>
  r.ok ? (harden(c, JSON_CSP), c.json(r.data, okStatus)) : err(c, r.status, r.code);

/** Hạn mức IP → khoá IP đoán link sai → dạng token → hạn mức token (cùng `EMAIL_LIMITS`, khoá riêng `sl:`). */
async function gate(
  c: Ctx,
  d: PartnerSignRoutesDeps,
  kind: Kind,
): Promise<{ ok: true; th: string; ip: string | null } | { ok: false; res: Response }> {
  const token = c.req.param("token") ?? "";
  const ip = ipOf(c, d.hops);
  const key = ip ?? "unknown";
  const tooMany = (retry: number) => {
    c.header("Retry-After", String(retry));
    return { ok: false as const, res: err(c, 429, "RATE_LIMITED") };
  };
  const byIp = await d.limit.hit(`sl:ip:${key}`, EMAIL_LIMITS.perIpMinute, 60);
  if (!byIp.ok) return tooMany(byIp.retryAfterS);
  if ((await d.limit.count(`sl:bad:${key}`, 600)) >= EMAIL_LIMITS.badTokenPerIp10Min)
    return tooMany(60);
  const bad = async () => {
    await d.limit.hit(`sl:bad:${key}`, EMAIL_LIMITS.badTokenPerIp10Min, 600);
    return { ok: false as const, res: err(c, 404, "NOT_FOUND") };
  };
  if (!TOKEN_RE.test(token)) return bad();
  const th = await hashHex(token);
  const lim =
    kind === "open"
      ? EMAIL_LIMITS.openPerTokenHour
      : kind === "pdf"
        ? EMAIL_LIMITS.pdfPerTokenHour
        : EMAIL_LIMITS.replyPerTokenHour * 6;
  const byToken = await d.limit.hit(`sl:${kind}:${th}`, lim, 3600);
  if (!byToken.ok) return tooMany(byToken.retryAfterS);
  return { ok: true, th, ip };
}

/** 404 từ cổng ⇒ cũng tính vào «link sai» của IP (chống đoán token). */
async function track<T>(c: Ctx, d: PartnerSignRoutesDeps, ip: string | null, r: SignLinkResult<T>) {
  if (!r.ok && r.status === 404 && r.code === "NOT_FOUND")
    await d.limit.hit(`sl:bad:${ip ?? "unknown"}`, EMAIL_LIMITS.badTokenPerIp10Min, 600);
  return r;
}

const csrfOk = (c: Ctx): boolean => {
  const cookie = getCookie(c, COOKIE) ?? "";
  const head = c.req.header("x-sign-csrf") ?? "";
  return sameSiteRequest(c.req.raw.headers) && cookie !== "" && safeEq(cookie, head);
};

async function readBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.infer<S> | null> {
  const raw = await c.req.json().catch(() => null);
  const p = schema.safeParse(raw);
  return p.success ? p.data : null;
}

export function partnerSignRoutes(d: PartnerSignRoutesDeps): Hono {
  const r = new Hono();

  r.get("/:token", async (c) => {
    const g = await gate(c, d, "open");
    if (!g.ok) return g.res;
    const p = d.port();
    if (!p) return err(c, 404, "NOT_FOUND");
    const res = await track(c, d, g.ip, await p.view(g.th, { audit: true }));
    if (!res.ok) return err(c, res.status, res.code);
    const csrf = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");
    setCookie(c, COOKIE, csrf, {
      httpOnly: true,
      sameSite: "Strict",
      path: `${SIGN_LINK_PUBLIC_PATH}/${c.req.param("token")}`,
      maxAge: 3600,
      secure: c.req.header("x-forwarded-proto") === "https",
    });
    harden(c, JSON_CSP);
    return c.json({ ...res.data, csrf });
  });

  const pdf = async (c: Ctx, fileId: string, versionId: string | null) => {
    const g = await gate(c, d, "pdf");
    if (!g.ok) return g.res;
    if (!uuid.safeParse(fileId).success || (versionId && !uuid.safeParse(versionId).success))
      return err(c, 404, "NOT_FOUND");
    const p = d.port();
    if (!p) return err(c, 404, "NOT_FOUND");
    const res = await track(c, d, g.ip, await p.content(g.th, fileId, versionId));
    if (!res.ok) return err(c, res.status, res.code);
    harden(c, PDF_CSP);
    c.header("Content-Type", "application/pdf");
    c.header(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(res.data.name)}`,
    );
    return c.body(res.data.bytes as Uint8Array<ArrayBuffer>);
  };
  r.get("/:token/files/:fileId", (c) => pdf(c, c.req.param("fileId") ?? "", null));
  r.get("/:token/versions/:fileId/:vid", (c) =>
    pdf(c, c.req.param("fileId") ?? "", c.req.param("vid") ?? ""),
  );

  /** POST chung: hạn mức → CSRF kép → thân (strict zod ⇒ 400) → cổng. */
  const post = <S extends z.ZodType>(
    path: string,
    schema: S,
    max: number,
    run: (
      p: PartnerSignPublicPort,
      th: string,
      b: z.infer<S>,
      c: Ctx,
    ) => Promise<Response | SignLinkResult<unknown>>,
    okStatus: 200 | 201 = 200,
  ) =>
    r.post(
      path,
      bodyLimit({ maxSize: max, onError: (c) => err(c, 413, "PAYLOAD_TOO_LARGE") }),
      async (c) => {
        const g = await gate(c, d, "write");
        if (!g.ok) return g.res;
        if (!csrfOk(c)) return err(c, 403, "CSRF");
        const body = await readBody(c, schema);
        if (body === null) return err(c, 400, "BAD_REQUEST");
        const p = d.port();
        if (!p) return err(c, 404, "NOT_FOUND");
        const res = await run(p, g.th, body, c);
        if (res instanceof Response) return res;
        return out(c, await track(c, d, g.ip, res), okStatus);
      },
    );

  post(
    "/:token/quick-signature",
    PartnerQuickSignatureBodySchema,
    300 * 1024,
    async (p, th, b, c) => {
      // Chuỗi base64 chuẩn (không ký tự lạ); PNG kiểm magic + IHDR + cỡ.
      const png = new Uint8Array(Buffer.from(b.png, "base64"));
      if (b.png.length % 4 !== 0 || !B64.test(b.png)) return err(c, 422, "SIGN_QUICK_PNG_INVALID");
      const chk = checkPng(png);
      if (chk === "too_large") return err(c, 413, "SIGN_QUICK_PNG_INVALID");
      if (chk !== "ok") return err(c, 422, "SIGN_QUICK_PNG_INVALID");
      return p.quick(th, { method: b.method, png });
    },
  );
  post("/:token/sign", PartnerSignBodySchema, 64 * 1024, (p, th, b) => p.sign(th, b), 201);
  post("/:token/decline", PartnerDeclineBodySchema, 16 * 1024, (p, th, b) => p.decline(th, b));
  return r;
}
