// N3-FR-05 · N3-FR-09 · lớp 4 module thông báo: nối kho + use case + route `/notifications` và (tùy chọn) vòng worker gửi.
// Route chuông LUÔN mở khi có db (đọc bảng, không phụ thuộc transport). Worker chỉ chạy khi `worker` và `mode` ≠ off; `live` chưa
// có adapter ⇒ ném `NotifyNotConfigured` lúc dựng ⇒ server không khởi động (fail-closed, ADR-0027 Proposed).
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Logger } from "../../lib/logger";
import { startLoop } from "../../lib/loop";
import type { SecretKey } from "../secrets/secrets.crypto";
import { HubSecretReader } from "../secrets/secrets.use";
import { hubCredentials } from "./adapters/credentials";
import { dispatchRepo } from "./adapters/dispatch.repo";
import { inboxRepo } from "./adapters/inbox.repo";
import { NOTIFICATIONS_PREFIX, notifyRoutes } from "./adapters/notify.routes";
import type { SmtpConfig } from "./adapters/smtp.transport";
import type { LiveNotifyConfig } from "./adapters/transports";
import { type NotifyMode, type Transports, transportsFor } from "./adapters/transports";
import type { VapidConfig } from "./adapters/webpush.transport";
import { drain } from "./application/dispatch.usecase";
import { InboxService } from "./application/inbox.service";

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

/** Phần `live` lấy từ env (không bí mật) + bí mật nếu đặt qua env; thiếu bí mật ⇒ đọc kho secret Hub lúc gửi. */
export type LiveEnv = {
  smtp: SmtpConfig;
  vapid: VapidConfig | null;
  smtpPassword?: string;
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
    smtp: e.smtp,
    vapid: e.vapid,
    smtpPassword: async () => e.smtpPassword ?? creds.use("smtp_password", async (v) => v),
    vapidPrivateKey: async () =>
      e.vapidPrivateKey ?? creds.use("vapid_private_key", async (v) => v),
  };
}

const DEFAULT_EVERY_MS = 2000;
const DEFAULT_BASE_URL = "http://localhost:3300";

export function mountNotify<E extends Env>(app: Hono<E>, d: NotifyMountDeps): void {
  const n = d.notify ?? {};
  const inbox = new InboxService(inboxRepo(d.db));
  app.route(NOTIFICATIONS_PREFIX, notifyRoutes(inbox, { publicKey: n.vapidPublicKey ?? null }));
  const transports =
    n.transports ?? transportsFor(n.mode ?? "off", n.live && liveConfig(d, n.live));
  if (!transports || !n.worker) return;
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
    tick: () => drain(deps),
    log: d.log,
    signal: d.signal,
  });
}
