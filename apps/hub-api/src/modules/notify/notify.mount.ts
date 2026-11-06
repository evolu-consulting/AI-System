// N3-FR-05 · N3-FR-09 · lớp 4 module thông báo: nối kho + use case + route `/notifications` và (tùy chọn) vòng worker gửi.
// Route chuông LUÔN mở khi có db (đọc bảng, không phụ thuộc transport). Worker chỉ chạy khi `worker` và `mode` ≠ off; `live` chưa
// có adapter ⇒ ném `NotifyNotConfigured` lúc dựng ⇒ server không khởi động (fail-closed, ADR-0027 Proposed).
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import { type SecretKey, sealHubSecret } from "../secrets/secrets.crypto";
import { HubSecretReader } from "../secrets/secrets.use";
import { hubCredentials } from "./adapters/credentials";
import { dispatchRepo } from "./adapters/dispatch.repo";
import { inboxRepo } from "./adapters/inbox.repo";
import { type MailConfig, mailConfigReader, seedMailSecret } from "./adapters/mail-config";
import { NOTIFICATIONS_PREFIX, notifyRoutes } from "./adapters/notify.routes";
import type { LiveNotifyConfig } from "./adapters/transports";
import { type NotifyMode, type Transports, transportsFor } from "./adapters/transports";
import type { VapidConfig } from "./adapters/webpush.transport";
import { drain } from "./application/dispatch.usecase";
import { InboxService } from "./application/inbox.service";
import type { EmailTransport } from "./application/ports";

export type NotifyDeps = {
  mode?: NotifyMode;
  /** Tiêm transport (test); vắng ⇒ theo `mode`. */
  transports?: Transports;
  /** `true` ⇒ dựng vòng worker (server). Test gọi `dispatchOnce`/`drain` trực tiếp nên để vắng. */
  worker?: boolean;
  baseUrl?: string;
  /** `mode = live`: cấu hình SMTP/VAPID (bí mật qua hàm lấy, xem `LiveNotifyConfig`). */
  live?: LiveEnv;
  vapidPublicKey?: string | null;
  /** Nhịp vòng khi hết việc (ms). */
  everyMs?: number;
  now?: () => Date;
};

/**
 * Phần `live` lấy từ env. CR-121 D4: cấu hình MAIL không đọc từ env khi gửi — `mailSeed` (từ env cũ) chỉ dùng để KHỞI TẠO kho secret
 * một lần khi kho chưa có; mọi lần gửi đọc kho secret Hub. VAPID giữ nguyên (ngoài phạm vi D4).
 */
export type LiveEnv = {
  vapid: VapidConfig | null;
  mailSeed?: MailConfig | null;
  vapidPrivateKey?: string;
};

export type NotifyMountDeps = {
  db: Db;
  notify?: NotifyDeps;
  signal?: AbortSignal;
  log: Logger;
  /** Khoá secrets Hub (`hubSecretsKey`) — để đọc `smtp_password`/`vapid_private_key` khi env không có. */
  hubSecretsKey?: SecretKey | null;
};

function liveConfig(d: NotifyMountDeps, e: LiveEnv): LiveNotifyConfig {
  const creds = hubCredentials(
    d.db,
    new HubSecretReader({ db: d.db, key: d.hubSecretsKey ?? null, log: d.log }),
  );
  return {
    mail: mailConfigReader(creds),
    vapid: e.vapid,
    vapidPrivateKey: async () =>
      e.vapidPrivateKey ?? creds.use("vapid_private_key", async (v) => v),
  };
}

async function seedFromEnv(d: NotifyMountDeps, seed: MailConfig | null | undefined): Promise<void> {
  if (!seed) return;
  if (!d.hubSecretsKey) {
    d.log.warn("notify_mail_secret_seed_skipped", { code: "hub_secrets_key_missing" });
    return;
  }
  try {
    const key = d.hubSecretsKey;
    const r = await seedMailSecret(d.db, (m, v) => sealHubSecret(key, m, v), seed);
    d.log.info("notify_mail_secret_seed", { result: r });
  } catch (err) {
    d.log.warn("notify_mail_secret_seed_failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}

const DEFAULT_EVERY_MS = 2000;
const DEFAULT_BASE_URL = "http://localhost:3300";

/** Trả cổng email của transport đang dùng (null khi thông báo tắt) — cho `/internal/mail` (admin-api gửi qua Hub, CR-121 c21b). */
export function mountNotify<E extends Env>(
  app: Hono<E>,
  d: NotifyMountDeps,
): { email: EmailTransport | null } {
  const n = d.notify ?? {};
  const inbox = new InboxService(inboxRepo(d.db));
  app.route(NOTIFICATIONS_PREFIX, notifyRoutes(inbox, { publicKey: n.vapidPublicKey ?? null }));
  const transports =
    n.transports ?? transportsFor(n.mode ?? "off", n.live && liveConfig(d, n.live));
  if (!transports) return { email: null };
  if (!n.worker) return { email: transports.email };
  // Khởi tạo kho secret mail từ env MỘT lần (không ghi đè); worker đợi xong lượt này rồi mới gửi.
  const seeded = seedFromEnv(d, n.live?.mailSeed);
  const deps = {
    store: dispatchRepo(d.db),
    ...transports,
    now: n.now ?? (() => new Date()),
    baseUrl: n.baseUrl ?? DEFAULT_BASE_URL,
  };
  // `drain` chạy tới khi hết việc rồi mới trả ⇒ vòng chỉ "ngủ" giữa các lượt khi không còn bản gửi tới hạn.
  startLoop({
    name: "notify-dispatch",
    everyMs: n.everyMs ?? DEFAULT_EVERY_MS,
    tick: async () => {
      await seeded;
      return drain(deps);
    },
    log: d.log,
    signal: d.signal,
  });
  return { email: transports.email };
}
