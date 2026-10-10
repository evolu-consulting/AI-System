// HUB-FR-105 · D10 · PF1 · `StageLauncher.kick`: tx người bắt đầu khoá run → kiểm lại quyền → `createRunTx` → `launch`.
// Bước 0: no-op (PF2 gọi được ngay sau trả lời).
import { NOOP_LAUNCHER, type StageLauncher } from "../core/ports";

export function createStageLauncher(): StageLauncher {
  return NOOP_LAUNCHER;
}
