// N2-FR-01 · N2-FR-03 · cầu nối gói ↔ engine quy trình dựng một lần mỗi app (khuôn `resolveBridge`): khởi chạy run
// (`PackRuns`, engine gắn `port` khi mount) + registry tool gói (gói đăng ký; engine/`/mcp` dùng). Tách khỏi `app.ts` (400 dòng).
import { PackToolRegistry } from "./modules/packs/kit/adapters/pack-tools.registry";
import type { PackRunsBridge } from "./modules/packs/kit/application/pack-runs.ports";
import type { PacksMountDeps } from "./modules/packs/packs.mount";

type DlcAgents = NonNullable<PacksMountDeps["dlcAgents"]>;

export function withPackBridges<D extends { packRuns?: PackRunsBridge; dlcAgents?: DlcAgents }>(
  d: D,
): D & { packRuns: PackRunsBridge; packTools: PackToolRegistry; dlcAgents: DlcAgents } {
  return {
    ...d,
    packRuns: d.packRuns ?? {},
    packTools: new PackToolRegistry(),
    dlcAgents: d.dlcAgents ?? {}, // dlc-engine · cầu Agent Hub cho gói `dlc`
  };
}
