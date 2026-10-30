// CR-105 · L1 · design §3 "vật chất hoá lười lúc mở lượt": mỗi lần mở (hoặc mở lại) lượt duyệt, gói tra quy trình của khe
// `contracts.approval` cho tenant (`port.resolveSlot`: gán ⇒ mặc định ⇒ bản xuất bản — 1 SQL), phân giải mã Group ⇒ id theo tenant
// (`groups.idsOf` — 1 SQL), rồi để `startEngineApproval` biên dịch + `ensureDef({sourceRef})` vào def tenant `contracts-approval`.
// Lớp 2. Không có bản xuất bản nào ⇒ null (L1 rơi về đường cũ `readFlow`; L4 xoá).
import type { FlowStep } from "../domain/approval-flow.types";
import {
  APPROVAL_SLOT,
  resolveSlotSteps,
  slotBodyOf,
  slotGroupKeys,
} from "../domain/approval-slot.rules";
import type {
  ApprovalEngineBridge,
  ApprovalEnginePort,
  EngineStartRequest,
} from "./approval-engine.ports";
import type { FlowGroups } from "./approval-flow.usecase";

/** Quy trình thư viện nguồn của mẫu đang chạy. */
export type SlotSource = { defId: string; name: string; relVersion: number };
/** Mẫu dựng từ khe: `version` = bản xuất bản (ghi vào lượt như `flow_version`). */
export type SlotFlow = {
  version: number;
  steps: readonly FlowStep[];
  defVersion: number;
  source: SlotSource;
};

/** Mẫu dùng mở run. `defVersion` = version def engine (`pack_version`; S3b: đổi cài đặt khi chưa lưu mẫu ⇒ tăng ⇒ ensureDef ghi
 *  đè). CR-105 · `source` = quy trình thư viện của khe (mẫu dựng từ bản xuất bản); vắng = mẫu tenant cũ (`readFlow`). */
export type EngineFlow = {
  version: number;
  steps: readonly FlowStep[];
  defVersion: number;
  source?: SlotSource | undefined;
};
/** Đối số `openRun`: `def` (đã biên dịch) ⇒ yêu cầu run kèm `slot` khi mẫu từ khe. */
export type OpenRunArgs = {
  id: string;
  flow: EngineFlow;
  starter: string;
  replaces?: string | null;
  def?: Record<string, unknown>;
};

type Deps = { bridge: ApprovalEngineBridge; groups: Pick<FlowGroups, "idsOf"> };

/**
 * Mẫu của khe cho tenant. `null` = khe chưa có bản áp được (đường cũ); `"invalid"` = body hỏng hoặc thiếu mã Group ở tenant
 * (Group bị xoá sau khi gán) ⇒ người gọi log `contract-engine-flow-invalid`, lượt chạy máy cũ.
 */
export async function slotFlowOf(d: Deps, tenantId: string): Promise<SlotFlow | "invalid" | null> {
  const port = d.bridge.port;
  if (!port?.resolveSlot || !port.sourceRefOf) return null;
  const r = await port.resolveSlot(tenantId, APPROVAL_SLOT);
  if (!r) return null;
  const body = slotBodyOf(r.slotBody);
  if (!body) return "invalid";
  const keys = slotGroupKeys(body);
  const ids = keys.length > 0 ? await d.groups.idsOf(tenantId, keys) : new Map<string, string>();
  const steps = resolveSlotSteps(body, ids);
  if (!steps) return "invalid";
  const source = { defId: r.defId, name: r.name, relVersion: r.relVersion };
  return { version: r.relVersion, steps, defVersion: r.relVersion, source };
}

/** `ensureDef` theo khe (`source_ref` = hash def đã biên dịch) hoặc theo version mẫu (đường cũ). */
export const defVersionOf = (
  flow: { defVersion: number; source?: SlotSource | undefined },
  def: Record<string, unknown>,
  port: Pick<ApprovalEnginePort, "sourceRefOf">,
): number | { sourceRef: string } =>
  flow.source && port.sourceRefOf ? { sourceRef: port.sourceRefOf(def) } : flow.defVersion;

/** Phần `slot` của yêu cầu mở run (engine kiểm `source_ref` + ghi tên/bản quy trình vào snapshot run). */
export function slotRunOf(
  flow: { source?: SlotSource | undefined },
  def: Record<string, unknown> | null | undefined,
  port: Pick<ApprovalEnginePort, "sourceRefOf">,
): Pick<EngineStartRequest, "slot"> {
  if (!flow.source || !def || !port.sourceRefOf) return {};
  const slot = {
    source_ref: port.sourceRefOf(def),
    process_name: flow.source.name,
    rel_version: flow.source.relVersion,
  };
  return { slot };
}
