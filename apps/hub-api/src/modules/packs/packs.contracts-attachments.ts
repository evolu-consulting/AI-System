// Nối tệp của gói contracts (tách khỏi `packs.mount.ts` cho đủ ≤ 400 dòng): CR-133 «Tài liệu kèm» (cần FileBox; `recordRunFiles` của hub tiêm ở đây — gói không import
// module hub) và CR-132 tin nhắn nhân viên (msg.* cần Redis, tệp cần FileBox). Gắn dưới `/pack/contracts`.

import type { Db } from "@ai/db";
import type { Env, Hono } from "hono";
import type { Redis } from "../../lib/redis";
import type { AttachmentStorage } from "../attachments/public";
import { recordRunFiles } from "../attachments/public";
import type { ConnectModuleDeps } from "./contracts/connect/connect.mount";
import { contractFilesModule } from "./contracts/contract-files.mount";
import { CONTRACTS_KEY } from "./contracts/contracts.mount";
import { messagesModule } from "./contracts/messages/messages.mount";
import { signDocModule } from "./contracts/sign-doc.mount";
import type { PackAccessView } from "./kit/public";
import { fileboxClients, type PackFb } from "./packs.filebox";
import { signDocPorts, signFlowOf } from "./packs.sign-doc";

export function mountContractAttachments<E extends Env>(
  app: Hono<E>,
  base: string,
  d: {
    db: Db;
    view: PackAccessView;
    fb: PackFb | null;
    redis?: Redis | undefined;
    /** CR-169 · bật vòng nền dọn tệp tin nhắn chưa gắn (server); test gọi thẳng `partnerFileSweep`. */
    worker?: boolean | undefined;
    signal?: AbortSignal | undefined;
    /** CR-181 · s9 · Q4 · kho tệp hub (chép «Chữ ký của tôi» vào bằng chứng duyệt). */
    storage?: AttachmentStorage | undefined;
  },
): void {
  const { db, view, fb } = d;
  const signFlow = signFlowOf(db, d.storage); // CR-181 s9 · gắn cổng ký trên tài liệu theo lượt (chặn Gửi, kiểm Đạt, bước Ký ondoc)
  if (fb) {
    const stepFiles = (w: Parameters<typeof recordRunFiles>[1], recordId: string) =>
      recordRunFiles(db, w, { packKey: CONTRACTS_KEY, recordId });
    app.route(base, contractFilesModule(db, view, fileboxClients(fb), stepFiles)); // CR-133 (FileBox vắng ⇒ không gắn)
    app.route(base, signDocModule(db, view, fileboxClients(fb), signDocPorts(db, view, signFlow))); // CR-181 s8 · ký trên tài liệu
  }
  app.route(
    base,
    messagesModule(db, view, {
      redis: d.redis,
      filebox: fb && fileboxClients(fb),
      worker: d.worker,
      signal: d.signal,
    }),
  ); // CR-132/169
}

/** CR-161/169 · phụ thuộc module kết nối + tin nhắn: Redis (`cc.link`/`msg.*`), FileBox (tệp tin nhắn), vòng nền dọn tệp (cùng cờ với vòng nhắc hạn). */
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

/** CR-181 · s9 · Q4 · kho tệp hub nếu app tiêm (`AppDeps.attachments`, cùng nguồn `evidenceDeps`) — chép «Chữ ký của tôi» vào bằng chứng. */
export const storageOf = (d: { db?: Db; attachments?: { storage: AttachmentStorage } }) =>
  d.attachments ? { storage: d.attachments.storage } : {};
