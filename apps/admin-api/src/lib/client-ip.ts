// L1 (TECH-DEBT #224) · IP của client cho giới hạn đăng nhập. Chỉ tin `X-Forwarded-For` khi cấu hình số proxy tin cậy
// (`TRUST_PROXY_HOPS`); không thì lấy địa chỉ socket của Bun. Không đọc được ⇒ null (bên gọi dồn vào một xô chung).
import { forwardedIp } from "@ai/contracts/client-ip";
import type { Context } from "hono";

// `forwardedIp` dùng chung với hub-api (`@ai/contracts/client-ip`); giữ export cũ cho test/nơi gọi sẵn có.
export { forwardedIp };

type BunEnv = { requestIP?: (req: Request) => { address: string } | null };

export function clientIp(c: Context, trustProxyHops: number): string | null {
  if (trustProxyHops > 0) return forwardedIp(c.req.header("x-forwarded-for"), trustProxyHops);
  try {
    return (c.env as BunEnv | undefined)?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}
