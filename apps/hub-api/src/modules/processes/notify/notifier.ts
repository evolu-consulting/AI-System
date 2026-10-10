// HUB-FR-112 · PF3 · `ProcessNotifier` (notice + `review_task.*`, plan §9). Bước 0: no-op — PF1/PF2 gọi được ngay.
import { NOOP_NOTIFIER, type ProcessNotifier } from "../core/ports";

export function createNotifier(): ProcessNotifier {
  return NOOP_NOTIFIER;
}
