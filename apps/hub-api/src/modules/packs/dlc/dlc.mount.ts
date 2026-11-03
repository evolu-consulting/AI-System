// dlc-engine · nối gói `dlc` (lớp 4): 3 khe thư viện quy trình (`dlc.new-system|enhancement|bug-fix` — admin dựng sơ đồ bước DLC
// ở Quy trình › Thư viện), tool `dlc-step` (stage của khe) + `dlc-start` (dlc-agent mở lượt trong Chat). Phía ngoài: workspace
// DLC qua HTTP (`DLC_WS_URL`, `DLC_WS_TOKEN`; vắng ⇒ bước báo "chưa cấu hình"), Agent Hub qua cầu `AgentHubBridge` (nền tảng gắn).
import type { Db } from "@ai/db";
import { logger } from "../../../lib/logger";
import { createPackUow } from "../kit/adapters/pack-uow";
import { slotRegistry } from "../kit/adapters/slot-registry";
import type { PackRunsBridge } from "../kit/application/pack-runs.ports";
import type { PackToolDef } from "../kit/application/pack-tools.ports";
import type { SlotSpec } from "../kit/application/slot.ports";
import { dlcReadRoutes } from "./adapters/dlc.routes";
import { dlcTools } from "./adapters/dlc.tools";
import { dlcRepos } from "./adapters/flows.repo";
import { type WorkspaceConfig, workspaceClient } from "./adapters/workspace.client";
import type { AgentHubBridge, WorkspacePort } from "./application/ports";
import { startDlcFlow } from "./application/start-flow.usecase";
import {
  compileDlcStages,
  DLC_MODES,
  DLC_PACK,
  DLC_SLOTS,
  type DlcMode,
  dlcBodyFromStages,
  dlcBodyOf,
  dlcGroupKeys,
  validateDlcBody,
} from "./domain/dlc-flow.rules";

export type { AgentHubBridge, AgentHubPort } from "./application/ports";
export { DLC_PACK };

export type DlcMountDeps = {
  db: Db;
  runs: PackRunsBridge;
  hub: AgentHubBridge;
  tools?: { register(t: PackToolDef): void };
  /** Vắng ⇒ đọc env `DLC_WS_URL` / `DLC_WS_TOKEN`. */
  workspace?: WorkspaceConfig | null;
};

/** Khe DLC của một dây chuyền: body = bước DLC; biên dịch theo chế độ của khe. */
export const dlcSlotSpec = (mode: DlcMode): SlotSpec => ({
  key: DLC_SLOTS[mode].key,
  label: DLC_SLOTS[mode].label,
  packKey: DLC_PACK,
  requiredInputs: [],
  systemTools: [],
  validate: validateDlcBody,
  compile: (b) => compileDlcStages(b, mode),
  groupKeys: (b) => {
    const body = dlcBodyOf(b);
    return body ? dlcGroupKeys(body) : [];
  },
  fromStages: dlcBodyFromStages,
});

function workspaceOf(cfg: WorkspaceConfig | null | undefined): WorkspacePort {
  const c = cfg ?? envWorkspace();
  if (c) return workspaceClient(c);
  const off = async (): Promise<never> => {
    throw new Error("dlc: chưa cấu hình workspace DLC (DLC_WS_URL, DLC_WS_TOKEN)");
  };
  return new Proxy({} as WorkspacePort, { get: () => off });
}

function envWorkspace(): WorkspaceConfig | null {
  const url = process.env.DLC_WS_URL?.trim();
  const token = process.env.DLC_WS_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

export function mountDlc(d: DlcMountDeps): void {
  for (const m of DLC_MODES) slotRegistry.register(dlcSlotSpec(m));
  if (!d.tools) return;
  const uow = createPackUow(d.db, DLC_PACK, dlcRepos);
  const ws = workspaceOf(d.workspace);
  const warn = (msg: string, meta: Record<string, unknown>) => logger.warn(msg, meta);
  const start = startDlcFlow({ runs: d.runs, ws, uow, warn });
  for (const t of dlcTools({ uow, ws, hub: d.hub }, start)) d.tools.register(t);
}

/** dlc-chat-review · route đọc của gói (`/pack/dlc/*`): nội dung đầy đủ của bước cho modal duyệt trong chat. */
export function dlcRoutes(db: Db, runs: PackRunsBridge = {}) {
  const uow = createPackUow(db, DLC_PACK, dlcRepos);
  return dlcReadRoutes({
    stepsView: (u, id) => (runs.port ? runs.port.stepsView(u, id) : Promise.resolve(null)),
    getFlow: (who, id) => uow.tenant(who, (r) => r.flows.get(id)),
  });
}
