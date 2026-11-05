// tool-seed-niti · catalog tool hệ thống của engine duyệt HĐ cho script seed (tách khỏi seed-niti.ts để giữ ≤ 400 dòng).
import { approvalEngineTools } from "../../../apps/hub-api/src/modules/packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../../apps/hub-api/src/modules/packs/contracts/approval.mount";
import { slotRegistry } from "../../../apps/hub-api/src/modules/packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../../apps/hub-api/src/modules/packs/kit/application/pack-tools.ports";
/** Khe `contracts.approval` thật + catalog tool hệ thống của engine duyệt (như test thư viện; script không chạy qua app.ts). */
export function approvalPackTools(): PackToolCatalog {
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  return {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
}
