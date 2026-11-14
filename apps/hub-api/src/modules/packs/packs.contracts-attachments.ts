// Nối tệp của gói contracts (tách khỏi `packs.mount.ts` cho đủ ≤ 400 dòng): CR-133 «Tài liệu kèm» (cần FileBox; `recordRunFiles` của hub tiêm ở đây — gói không import
// module hub) và CR-132 tin nhắn nhân viên (msg.* cần Redis, tệp cần FileBox). Gắn dưới `/pack/contracts`.
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Redis } from "../../lib/redis";
import { recordRunFiles } from "../attachments/public";
import type { ConnectModuleDeps } from "./contracts/connect/connect.mount";
import { contractFilesModule } from "./contracts/contract-files.mount";
import { CONTRACTS_KEY } from "./contracts/contracts.mount";
import { messagesModule } from "./contracts/messages/messages.mount";
import type { PackAccessView } from "./kit/public";
import { fileboxClients, type PackFb } from "./packs.filebox";

export function mountContractAttachments<E extends Env>(
  app: Hono<E>,
  base: string,
  d: { db: Db; view: PackAccessView; fb: PackFb | null; redis?: Redis | undefined },
): void {
  const { db, view, fb } = d;
  if (fb) {
    const stepFiles = (w: Parameters<typeof recordRunFiles>[1], recordId: string) =>
      recordRunFiles(db, w, { packKey: CONTRACTS_KEY, recordId });
    app.route(base, contractFilesModule(db, view, fileboxClients(fb), stepFiles)); // CR-133 (FileBox vắng ⇒ không gắn)
  }
  app.route(base, messagesModule(db, view, { redis: d.redis, filebox: fb && fileboxClients(fb) })); // CR-132
}

/** CR-161 · phụ thuộc module kết nối hai công ty: Redis (`cc.*`), FileBox (tệp trò chuyện), vòng nền dọn tệp (cùng cờ với vòng nhắc hạn). */
export function connectDeps(
  d: {
    redis?: Redis | undefined;
    appEnv?: string | undefined;
    signal?: AbortSignal | undefined;
    packs?: { contractsRemind?: { worker?: boolean | undefined } | undefined } | undefined;
  },
  fb: PackFb | null,
): ConnectModuleDeps {
  const env = d.appEnv ?? process.env.APP_ENV;
  return {
    redis: d.redis,
    filebox: fb && fileboxClients(fb),
    worker:
      d.packs?.contractsRemind?.worker ??
      ((env === "development" || env === "production") && process.env.CONTRACTS_REMIND !== "off"),
    signal: d.signal,
  };
}
