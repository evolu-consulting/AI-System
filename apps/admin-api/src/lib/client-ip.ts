// L1 (TECH-DEBT #224) · IP của client cho giới hạn đăng nhập. Chỉ tin `X-Forwarded-For` khi cấu hình số proxy tin cậy
// (`TRUST_PROXY_HOPS`); không thì lấy địa chỉ socket của Bun. Không đọc được ⇒ null (bên gọi dồn vào một xô chung).
import type { Context } from "hono";

type BunEnv = { requestIP?: (req: Request) => { address: string } | null };

/**
 * `hops` = số proxy tin cậy đứng trước app; mỗi proxy NỐI địa chỉ nó thấy vào cuối XFF, nên client thật là phần tử
 * thứ `hops` tính từ cuối. Phần client tự ghi (bên trái) bị bỏ qua — không giả mạo được để né giới hạn.
 */
export function forwardedIp(xff: string | undefined, hops: number): string | null {
  if (!xff || hops < 1) return null;
  const parts = xff
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // L1c (A-6): ít phần tử hơn số proxy tin cậy ⇒ phần còn lại do client tự ghi ⇒ không tin (xô `unknown`).
  if (parts.length < hops) return null;
  return parts[parts.length - hops] ?? null;
}

export function clientIp(c: Context, trustProxyHops: number): string | null {
  if (trustProxyHops > 0) return forwardedIp(c.req.header("x-forwarded-for"), trustProxyHops);
  try {
    return (c.env as BunEnv | undefined)?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}
