// N3-FR-07 · ADR-0027 · transport PUSH thật trên `web-push` (Web Push + VAPID, mã hóa aes128gcm do thư viện lo). Khoá riêng VAPID
// KHÔNG ở đây: `getPrivateKey()` do nơi dựng truyền vào (env VAPID_PRIVATE_KEY hoặc `hub.secrets` kind `vapid_private_key`).
// Mỗi tin một yêu cầu HTTP song song, có hạn; lỗi ánh xạ qua `mapPushError` (404/410 ⇒ đăng ký hết hạn).
import webpush from "web-push";
import type { PushTransport } from "../application/ports";
import type { PushMessage, SendResult } from "../domain/notify.rules";

export type VapidConfig = { publicKey: string; subject: string };

export type PushSender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  opts: {
    TTL: number;
    topic: string;
    timeout: number;
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
  },
) => Promise<unknown>;

export const realPushSender: PushSender = (sub, payload, opts) =>
  webpush.sendNotification(sub, payload, opts);

const TTL_S = 24 * 3600;
const REQUEST_TIMEOUT_MS = 20_000; // < TRANSPORT_TIMEOUT_MS (60 s)

/** 404/410 ⇒ đăng ký hết hạn (xóa); 400/413 ⇒ vĩnh viễn; 401/403 (VAPID sai), 429, 5xx, mạng ⇒ thử lại. */
export function mapPushError(err: unknown): SendResult {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  if (status === 404 || status === 410)
    return { ok: false, permanent: true, code: `push_${status}`, gone: true };
  if (status === 400 || status === 413)
    return { ok: false, permanent: true, code: `push_${status}` };
  if (typeof status === "number") return { ok: false, permanent: false, code: `push_${status}` };
  const name = (err as { code?: unknown } | null)?.code;
  return {
    ok: false,
    permanent: false,
    code: `push_${typeof name === "string" ? name.toLowerCase() : "error"}`,
  };
}

export function createWebPushTransport(
  cfg: VapidConfig | null,
  getPrivateKey: () => Promise<string | undefined>,
  send: PushSender = realPushSender,
): PushTransport {
  return {
    async sendBatch(msgs: readonly PushMessage[]): Promise<SendResult[]> {
      const privateKey = cfg ? await getPrivateKey() : undefined;
      if (!cfg || !privateKey)
        return msgs.map(() => ({ ok: false, permanent: true, code: "vapid_not_configured" }));
      const vapidDetails = { subject: cfg.subject, publicKey: cfg.publicKey, privateKey };
      const out = await Promise.allSettled(
        msgs.map((m) =>
          send({ endpoint: m.endpoint, keys: { p256dh: m.p256dh, auth: m.auth } }, m.payload, {
            TTL: TTL_S,
            topic: m.idempotencyKey,
            timeout: REQUEST_TIMEOUT_MS,
            vapidDetails,
          }),
        ),
      );
      return out.map((r) => (r.status === "fulfilled" ? { ok: true } : mapPushError(r.reason)));
    },
  };
}
