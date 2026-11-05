// CR-118 N3 · UW-FR-05 · ảnh cấu hình đổi (LISTEN `config_changed`/`hub_config_changed` → ConfigCache nạp xong) ⇒ đẩy
// `event: config.changed` tới phiên `/me/stream` đang mở trên instance này của tenant bị chạm (null = mọi tenant). Gộp các
// lần đổi trong cùng một lượt microtask thành một frame; web refetch `/pack/me` (ETag ⇒ 304 nếu lát cắt của user không đổi).
import { ME_STREAM_CONFIG_CHANGED } from "@ai/contracts/capabilities";
import type { ConfigChange } from "../config/config.service";

type ChangeSource = { onChange(fn: (c: ConfigChange) => void): () => void };
type Broadcaster = { broadcast(frame: string, tenants: ReadonlySet<string> | null): number };

export const configChangedFrame = (v: { admin: number; hub: number }): string =>
  `event: ${ME_STREAM_CONFIG_CHANGED}\ndata: ${JSON.stringify({ admin: v.admin, hub: v.hub })}\n\n`;

/** Nối nguồn đổi → phiên SSE. Trả hàm huỷ; `signal` abort ⇒ huỷ. */
export function startConfigPush(
  src: ChangeSource,
  conns: Broadcaster,
  signal?: AbortSignal,
): () => void {
  let pending: { last: ConfigChange; tenants: Set<string> | null } | null = null;
  const flush = () => {
    const p = pending;
    pending = null;
    if (p) conns.broadcast(configChangedFrame(p.last), p.tenants);
  };
  const off = src.onChange((c) => {
    if (!pending) {
      pending = { last: c, tenants: c.tenants ? new Set(c.tenants) : null };
      queueMicrotask(flush);
      return;
    }
    pending.last = c;
    if (!c.tenants) pending.tenants = null;
    else if (pending.tenants) for (const t of c.tenants) pending.tenants.add(t);
  });
  signal?.addEventListener("abort", off, { once: true });
  return off;
}
