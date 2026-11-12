// Nối tệp của gói contracts (tách khỏi `packs.mount.ts` cho đủ ≤ 400 dòng): CR-133 «Tài liệu kèm» (cần FileBox; `recordRunFiles` của hub tiêm ở đây — gói không import
// module hub) và CR-132 tin nhắn nhân viên (msg.* cần Redis, tệp cần FileBox). Gắn dưới `/pack/contracts`.
import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Redis } from "../../lib/redis";
import { recordRunFiles } from "../attachments/public";
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
