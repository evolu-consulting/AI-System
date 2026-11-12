// CR-127 K3 · sổ cổng engine cho gói (`FlowAvailability` + `FlowRunControl`): `processes` đăng ký MỘT lần lúc mount, gói đọc lúc gọi
// (gói không import được `processes`). Chưa đăng ký (test gói không mount engine) ⇒ null.
import type { FlowEngine } from "../application/flow-events.ports";

let current: FlowEngine | null = null;
export function registerFlowEngine(e: FlowEngine | null): void {
  current = e;
}
export const flowEngine = (): FlowEngine | null => current;
