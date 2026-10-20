// HD8-FR-05 · D8-10 · port `link_check.fetch/public_url/inspect`: máy chủ mở link giá người dán, tìm đúng con số. Chống SSRF như mgmt:
// chỉ http(s); tự phân giải DNS, MỌI địa chỉ phải công khai; nối thẳng tới IP đã kiểm (SNI + Host = tên miền ⇒ DNS đổi giữa chừng
// không lái được kết nối — thay `_check_peer`); không proxy; chuyển hướng kiểm lại từng bước (≤ 5); ≤ 3 MB; MỘT hạn 15 s
// (`AbortSignal.timeout`) cho CẢ lượt: tra DNS, mọi bước chuyển hướng, đọc thân (review HD78 #3 — trước chỉ hết giờ khi socket rảnh).
// Lỗi mạng/403/hết giờ ⇒ báo giá vẫn lưu, chưa kiểm (như mgmt).
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { type Inspect, isPublicIp, judge, NOTE } from "../domain/link-check.rules";

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

export type Resolve = (host: string) => Promise<string[]>;
const dnsResolve: Resolve = async (host) =>
  (await lookup(host, { all: true })).map((a) => a.address);

class LinkError extends Error {}

/** Hết hạn ⇒ `LinkError("TimeoutError")` (tên lỗi như mgmt). */
const expired = () => new LinkError("TimeoutError");
/** Chờ `p` nhưng dừng ngay khi `signal` hết hạn (tra DNS không huỷ được ⇒ bỏ kết quả, không chờ). */
function within<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(expired());
  return new Promise<T>((done, fail) => {
    const stop = () => fail(expired());
    signal.addEventListener("abort", stop, { once: true });
    p.then(done, fail).finally(() => signal.removeEventListener("abort", stop));
  });
}

/** `public_url`: http(s), có tên máy, mọi địa chỉ phân giải ra đều công khai ⇒ trả IP dùng để nối; không ⇒ null. */
export async function publicTarget(
  raw: string,
  resolve: Resolve = dnsResolve,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<{ url: URL; ip: string } | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs: string[];
  try {
    addrs = /^[\d.]+$|:/.test(host) ? [host] : await within(resolve(host), signal);
  } catch (e) {
    if (e instanceof LinkError) throw e;
    return null;
  }
  return addrs.length && addrs.every(isPublicIp) ? { url, ip: addrs[0] as string } : null;
}

function get(
  t: { url: URL; ip: string },
  signal: AbortSignal,
): Promise<{ status: number; location?: string; body: string }> {
  if (signal.aborted) return Promise.reject(expired());
  return new Promise((done, fail) => {
    const mod = t.url.protocol === "https:" ? https : http;
    const req = mod.request(
      {
        host: t.ip,
        port: t.url.port || (t.url.protocol === "https:" ? 443 : 80),
        path: `${t.url.pathname}${t.url.search}`,
        method: "GET",
        servername: t.url.hostname,
        headers: {
          Host: t.url.host,
          "User-Agent": "Mozilla/5.0 (price check)",
          "Accept-Language": "vi",
        },
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size <= MAX_BYTES) chunks.push(c);
          else res.destroy();
        });
        res.on("close", () =>
          // hết hạn giữa lúc đọc thân ⇒ lỗi hết giờ, không trả nửa trang
          signal.aborted
            ? fail(expired())
            : done({
                status: res.statusCode ?? 0,
                location: res.headers.location,
                body: Buffer.concat(chunks).subarray(0, MAX_BYTES).toString("utf8"),
              }),
        );
        res.on("error", (e) => fail(signal.aborted ? expired() : e));
      },
    );
    req.on("error", (e) => fail(signal.aborted ? expired() : e));
    req.end();
  });
}

/** `fetch`: trang (≤ 3 MB) sau các bước chuyển hướng đã kiểm; mã ≥ 400 ⇒ lỗi (như urllib). */
export async function fetchPage(
  raw: string,
  resolve: Resolve = dnsResolve,
  signal: AbortSignal = AbortSignal.timeout(TIMEOUT_MS),
): Promise<string> {
  let next = raw;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const t = await publicTarget(next, resolve, signal);
    if (!t) throw new LinkError("URLError");
    const r = await get(t, signal);
    if (r.status >= 300 && r.status < 400 && r.location) {
      next = new URL(r.location, t.url).toString();
      continue;
    }
    if (r.status >= 400) throw new LinkError("HTTPError");
    return r.body;
  }
  throw new LinkError("HTTPError");
}

/** `inspect`: link không công khai ⇒ "Link không hợp lệ"; mở lỗi ⇒ chưa kiểm + lý do; có trang ⇒ tìm đúng con số. */
export function createInspect(
  d: {
    resolve?: Resolve;
    /** Thay bước tải trang (test); có ⇒ bỏ kiểm DNS công khai. */
    loadPage?: (url: string) => Promise<string>;
    now?: () => Date;
    timeoutMs?: number;
  } = {},
): Inspect {
  const resolve = d.resolve ?? dnsResolve;
  const year = () => (d.now ?? (() => new Date()))().getUTCFullYear();
  return async (url, price) => {
    const signal = AbortSignal.timeout(d.timeoutMs ?? TIMEOUT_MS);
    try {
      if (!d.loadPage && !(await publicTarget(url, resolve, signal)))
        return { verified: false, page_date: null, note: NOTE.invalid };
      return judge(
        await (d.loadPage ? d.loadPage(url) : fetchPage(url, resolve, signal)),
        price,
        year(),
      );
    } catch (e) {
      const why = e instanceof LinkError ? e.message : e instanceof Error ? e.name : "Error";
      return { verified: false, page_date: null, note: NOTE.failed(why) };
    }
  };
}
