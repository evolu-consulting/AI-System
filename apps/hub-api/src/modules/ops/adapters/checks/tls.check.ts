// CR-104 · ops-checks · "Chứng chỉ TLS": số ngày còn lại của chứng chỉ mỗi host https (node:tls, SNI = hostname, không xác thực
// chuỗi — chỉ đọc ngày hết hạn; host sập đã có check Host công khai). Xấu nhất quyết định trạng thái (warn < N ngày, crit < M ngày).
import { connect } from "node:tls";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { publicUrlsFromEnv, thresholds } from "./check-kit";

const DAY_MS = 86_400_000;
export const TLS_TIMEOUT_MS = 10_000;

/** Lấy ngày hết hạn chứng chỉ; ném lỗi khi không kết nối được. Tiêm được trong test. */
export type CertExpiry = (host: string, port: number, signal: AbortSignal) => Promise<Date>;

export const realCertExpiry: CertExpiry = (host, port, signal) =>
  new Promise((resolve, reject) => {
    const s = connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const exp = s.getPeerCertificate().valid_to;
      s.end();
      const t = exp ? Date.parse(exp) : Number.NaN;
      if (Number.isNaN(t)) reject(new Error("no-cert"));
      else resolve(new Date(t));
    });
    const fail = (e: unknown) => {
      s.destroy();
      reject(e instanceof Error ? e : new Error("tls"));
    };
    s.setTimeout(TLS_TIMEOUT_MS, () => fail(new Error("timeout")));
    s.on("error", fail);
    signal.addEventListener("abort", () => fail(new Error("abort")), { once: true });
  });

export type CertInfo = { host: string; days: number | null };

const HINT =
  "Gia hạn chứng chỉ: kiểm tra tiến trình cấp/gia hạn tự động của edge (Cloudflare/ACME), chạy gia hạn thủ công rồi nạp lại edge.";

/** Thuần: `days = null` = không đọc được chứng chỉ host đó. */
export function evaluateTls(
  certs: readonly CertInfo[],
  warnDays: number,
  critDays: number,
): OpsCheckResult {
  const got = certs.filter((c): c is { host: string; days: number } => c.days !== null);
  const failed = certs.length - got.length;
  if (got.length === 0)
    return { status: "unknown", message: "Không đọc được chứng chỉ của host nào", hint: HINT };
  const worst = got.reduce((a, b) => (b.days < a.days ? b : a));
  const value = { min_days: worst.days, hosts: certs.map((c) => ({ host: c.host, days: c.days })) };
  const extra = failed > 0 ? ` (${failed} host không đọc được)` : "";
  if (worst.days < critDays)
    return {
      status: "crit",
      value,
      message: `Chứng chỉ ${worst.host} ${worst.days < 0 ? "đã hết hạn" : `còn ${worst.days} ngày`}${extra}`,
      hint: HINT,
    };
  if (worst.days < warnDays)
    return {
      status: "warn",
      value,
      message: `Chứng chỉ ${worst.host} còn ${worst.days} ngày${extra}`,
      hint: HINT,
    };
  return {
    status: "ok",
    value,
    message: `Chứng chỉ còn tối thiểu ${worst.days} ngày${extra}`,
  };
}

export function makeTlsCheck(
  expiry: CertExpiry = realCertExpiry,
  urls: () => URL[] = () => publicUrlsFromEnv(),
): OpsCheck {
  return {
    key: "tls",
    timeoutMs: TLS_TIMEOUT_MS + 5_000,
    async run(d, cfg) {
      const https = urls().filter((u) => u.protocol === "https:");
      if (https.length === 0)
        return { status: "unknown", message: "chưa cấu hình (không có host https)" };
      const t = thresholds("tls", cfg);
      const certs = await Promise.all(
        https.map(async (u): Promise<CertInfo> => {
          try {
            const exp = await expiry(u.hostname, Number(u.port || 443), d.signal);
            return {
              host: u.hostname,
              days: Math.floor((exp.getTime() - d.now.getTime()) / DAY_MS),
            };
          } catch {
            return { host: u.hostname, days: null };
          }
        }),
      );
      return evaluateTls(certs, t.warn ?? 14, t.crit ?? 3);
    },
  };
}

export const tlsCheck = makeTlsCheck();
