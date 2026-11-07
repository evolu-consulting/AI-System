// CR-125 · m2 · MOD-FR-02 · kiểm sổ module lúc khởi động (gọi cuối `mountPacks`): khai báo `MODULES` × binding máy chủ đã đăng ký.
// Một lần, O(node + sự kiện), không SQL. Tách khỏi `packs.mount.ts` (trần 400 dòng).
import { APP_MANIFESTS } from "@ai/contracts/app-manifest";
import { MODULES, withEvents } from "@ai/contracts/modules";
import type { Db } from "@ai/db";
import { logger } from "../../lib/logger";
import { type ModuleRegistry, moduleRegistry } from "./kit/public";

/** App của sổ module đang gắn ở lần mount này (`core` luôn; contracts theo cờ gói; community cần DB). */
export function mountedApps(d: {
  db?: Db | undefined;
  packs?: { contracts?: boolean } | undefined;
}) {
  return [
    "core",
    ...(d.db && (d.packs?.contracts ?? true) ? ["contracts"] : []),
    ...(d.db ? ["community"] : []),
  ];
}

/** Sự kiện ghép từ manifest như m1 (`withEvents`). Có lỗi ⇒ log `error` + ném «Khởi động dừng: N lỗi module». */
export function verifyPackModules(
  apps: readonly string[],
  registry: ModuleRegistry = moduleRegistry,
): void {
  const mods = withEvents(MODULES, Object.values(APP_MANIFESTS));
  registry.verify(mods, { apps, log: (m, meta) => logger.error(m, meta) });
}
