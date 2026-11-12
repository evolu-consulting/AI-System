// CR-132 M3 · HD-MSG-01..12 · nối API tin nhắn Sổ Hợp Tác: `PackUow` (role `contracts_rw`) + tra người dùng (kit, admin.users) → use case → route. Gắn dưới
// `/pack/contracts` ở `packs.mount.ts`. Không cần FileBox (tải tệp lên ở M5).
import type { Db } from "@ai/db";
import type { Hono } from "hono";
import {
  createPackUow,
  internalUsersAmong,
  type PackAccessView,
  type PackGuardVars,
  packTenantOnly,
} from "../../kit/public";
import { messagesRepo } from "./adapters/messages.repo";
import { messagesRoutes } from "./adapters/messages.routes";
import { messagesUsecases } from "./application/messages.usecase";

export function messagesModule(db: Db, view: PackAccessView): Hono<PackGuardVars> {
  const uc = messagesUsecases({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({ messages: messagesRepo(tx, t) })),
    ),
    people: internalUsersAmong(db),
    newId: () => Bun.randomUUIDv7(),
  });
  return messagesRoutes(view, uc);
}
