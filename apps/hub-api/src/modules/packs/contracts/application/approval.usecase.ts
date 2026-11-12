// HD-FR-34 · HD-FR-36 · HD-FR-37 · CR-127 Z1 (BR-78): thẻ duyệt + hành động của lượt duyệt HĐ trên ENGINE (`mode = 'engine'`), cài đặt tenant.
// Máy duyệt 2 bước cũ (startApproval/decide/finalize cấp 1–2, "Xác nhận và lưu" của lượt máy cũ) đã gỡ: HĐ vào quy trình qua "Gửi"
// (`submit.usecase`), AI đọc xong ⇒ nháp chờ rà soát. Lượt không phải engine chỉ hiển thị (lượt đọc AI), không ai quyết được.
// Lớp 2: chỉ cổng, lỗi trả mã (route dịch).
import type { PackWho } from "../../kit/public";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import { approvalView } from "../domain/approval-run.rules";
import type { ApprovalState, ApprovalTxRepos, ApprovalUow } from "./approval.ports";
import type { ActOutcome, ApprovalAction, ContractApproval } from "./approval-act.types";
import type { EngineCard } from "./approval-engine-card.usecase";

export type { ActOutcome, ApprovalAction, ContractApproval } from "./approval-act.types";

/** Group theo khoá của tenant (thiếu ⇒ vắng) — kiểm Group khi lưu cài đặt duyệt. */
export type ApprovalGroups = {
  idsOf(tenantId: string, keys: readonly string[]): Promise<ReadonlyMap<string, string>>;
};
export type ExtractJob = {
  tenantId: string;
  userId: string;
  contractId: string;
  approvalId: string | null;
};
/** Hàng đợi bền lượt AI đọc (Redis Streams) — gọi SAU commit. */
export type ExtractJobs = { enqueue(job: ExtractJob): Promise<void> };

export type ApprovalDeps = {
  uow: ApprovalUow;
  groups: ApprovalGroups;
  /** contract-flow S3b · thẻ + hành động cho lượt `mode = 'engine'`. Vắng ⇒ lượt engine hiện thẻ rỗng, không quyết được. */
  card?: EngineCard;
  /** S3b · cài đặt duyệt đổi (tenant chưa lưu mẫu) ⇒ đồng bộ lại def engine. Không ném. */
  onSettingsSaved?: (who: PackWho) => Promise<unknown>;
};

async function engineViewOf(
  d: ApprovalDeps,
  who: PackWho,
  st: ApprovalState,
): Promise<ContractApproval> {
  if (d.card) return d.card.view(who, st);
  return { ...approvalView(st.approval), mode: "engine" as const, steps: [] };
}

export function getApproval(d: ApprovalDeps) {
  return async (who: PackWho, id: string): Promise<ContractApproval | null> => {
    const st = await d.uow.tenant(who, (r) => r.approval.state(id, { lock: false }));
    if (!st) return null;
    if (st.approval?.mode === "engine") return engineViewOf(d, who, st);
    return approvalView(st.approval); // lượt đọc AI / chưa có lượt: chỉ hiển thị
  };
}

/** CR-109 · đọc trước (không khoá) để biết chế độ: CHỈ lượt engine mới mở nhánh người duyệt ngoài cây khi khoá. */
async function lockedState(r: ApprovalTxRepos, id: string): Promise<ApprovalState | null> {
  const peek = await r.approval.state(id, { lock: false });
  if (!peek) return null;
  return r.approval.state(id, { lock: true, approval: peek.approval?.mode === "engine" });
}

/** S3b · quyết trên engine (ngoài tx khoá HĐ) rồi trả thẻ mới. */
async function actOnEngine(
  d: ApprovalDeps,
  who: PackWho,
  id: string,
  b: ApprovalAction,
  st: ApprovalState,
): Promise<ActOutcome> {
  const res = d.card ? await d.card.act(who, id, b, st) : { error: "APPROVAL_NOT_OPEN" as const };
  if (res === "unavailable") return res;
  if (res !== "ok") return { error: res.error };
  return (await getApproval(d)(who, id)) ?? "not_found";
}

/** Quyết bước đang mở của lượt ENGINE: khoá HĐ để biết chế độ rồi quyết qua engine; không có lượt engine ⇒ `APPROVAL_NOT_OPEN`. */
export function actApproval(d: ApprovalDeps) {
  return async (who: PackWho, id: string, b: ApprovalAction): Promise<ActOutcome> => {
    const st = await d.uow.tenant(who, (r) => lockedState(r, id));
    if (!st) return "not_found";
    if (st.approval?.mode !== "engine") return { error: "APPROVAL_NOT_OPEN" };
    return actOnEngine(d, who, id, b, st);
  };
}

/** HD-FR-37 · lưu cài đặt + nhật ký; Group không có ở tenant ⇒ `group_missing` (không lưu). */
export function saveApprovalSettings(d: ApprovalDeps) {
  return async (who: PackWho, s: ApprovalSettings): Promise<ApprovalSettings | "group_missing"> => {
    const ids = await d.groups.idsOf(who.tenantId, [s.level1GroupKey, s.level2GroupKey]);
    if (!ids.has(s.level1GroupKey) || !ids.has(s.level2GroupKey)) return "group_missing";
    const saved = await d.uow.tenant(who, (r) => r.approval.saveSettings(s, who.userId));
    await d.onSettingsSaved?.(who);
    return saved;
  };
}

export function readApprovalSettings(d: Pick<ApprovalDeps, "uow">) {
  return (who: PackWho) => d.uow.tenant(who, (r) => r.approval.settings());
}
