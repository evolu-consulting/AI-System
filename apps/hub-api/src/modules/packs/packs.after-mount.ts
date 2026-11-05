// Kiểm sau khi MỌI gói đã mount (tách khỏi `packs.mount.ts`, trần 400 dòng): tool trùng catalog (Security L1) + CR-120 khe manifest
// thiếu SlotSpec/FlowSlotAdapter (ADR-0036, log error, không chặn boot).
import { logger } from "../../lib/logger";
import type { ConfigCache } from "../config/public";
import type { PackToolRegistry } from "./kit/public";
import { checkSlotContract } from "./kit/public";

type PacksMountDeps = { config: ConfigCache; packTools?: PackToolRegistry | undefined };

export function afterPacksMounted(d: PacksMountDeps): void {
  rejectToolCollisions(d);
  checkSlotContract();
}

/** Security L1 · sau khi mọi gói đăng ký: tool gói trùng khoá workflow catalog bị gỡ (ảnh catalog đầu tiên, cache). */
function rejectToolCollisions(d: PacksMountDeps): void {
  const tools = d.packTools;
  if (!tools) return;
  void d.config
    .catalog()
    .then((c) =>
      tools.rejectCatalogCollisions(new Set([...c.workflows.values()].map((w) => w.key))),
    )
    .catch(() => logger.warn("pack-tool-collision-check-failed", {}));
}
