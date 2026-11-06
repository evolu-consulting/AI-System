// CR-122 · A1 · FLOW2-FR-18/19 · cổng gói Hợp đồng bắn sự kiện flow. Lớp 2: chỉ kiểu + hàm thuần; SQL ở `adapters/contract-flow.repo.ts`.
import type { ContractEvent } from "../domain/contract-flow-events.rules";

/** Ghi sự kiện CÙNG tx bản ghi (đã nằm trong `PackUow.tenant`). Vắng ⇒ gói chưa nối (test cũ) ⇒ không bắn. */
export type ContractFlowRepo = {
  /** `contract.submitted` | `contract.approved`: facts từ hàng HĐ + phòng ban người tạo. true = ghi mới. */
  emitContract(
    event: Exclude<ContractEvent, "contract.uploaded">,
    contractId: string,
    versionKey: string,
    o: { actor: string | null; departments: readonly string[] | null },
  ): Promise<boolean>;
  /** `contract.uploaded`: facts = loại tệp + phòng ban người tải. */
  emitUploaded(
    contractId: string,
    o: { fileType: string; actor: string | null; departments: readonly string[] | null },
  ): Promise<boolean>;
  readFacts(
    contractId: string,
  ): Promise<{ facts: Record<string, unknown>; startedBy: string | null } | null>;
  /**
   * CR-122 · P11 · cờ BẬT, lượt vừa vào `level1` + đã ghi `contract.submitted`: lượt chuyển `mode = 'engine'`, chưa có run, lý do
   * `FLOW_STARTING` ⇒ máy cũ không còn quyết / khoá HĐ được; bộ điều phối gắn run (`attachFlowRun`). Có điều kiện, chạy lại vô hại.
   */
  holdForFlow?(contractId: string, approvalId: string): Promise<boolean>;
  /** Chạy `fn` (với repo trên tx CON) trong SAVEPOINT: lỗi ⇒ rollback về savepoint + log, tx bản ghi chạy tiếp (chỉ khi cờ TẮT = bóng). */
  shadow?(event: string, fn: (repo: ContractFlowRepo) => Promise<unknown>): Promise<void>;
};
export type ContractFlowTxRepos = { contractFlow?: ContractFlowRepo | undefined };

/** Kết quả đọc cờ TRƯỚC tx (role gói không đọc `hub.tenant_flow_settings`): bật ⇒ bắn sự kiện, KHÔNG mở lượt theo đường cũ. */
export type FlowPrep = { on: boolean; departments: readonly string[] | null };
export const FLOW_OFF: FlowPrep = { on: false, departments: null };
/** CR-122 · P11 · lý do của lượt đang chờ bộ điều phối mở flow (thẻ không báo "kẹt" với lý do này). */
export const FLOW_STARTING = "FLOW_STARTING";
/** Sự kiện được phát khi cổng đã trả lời (cờ bật HOẶC tắt = bóng); không cổng / lỗi cổng / chưa tới bước ⇒ `FLOW_OFF` ⇒ không phát. */
export const flowEmits = (p: FlowPrep): boolean => p !== FLOW_OFF;
/** `prepare` đọc cờ `flowTriggersOn(tenant)` (+ phòng ban người gây sự kiện khi bật). Không ném: lỗi ⇒ tắt (đường cũ). */
export type ContractFlowGate = {
  prepare(tenantId: string, userId: string): Promise<FlowPrep>;
};

/** Cờ bật ⇒ repo bắt buộc; cờ tắt ⇒ bóng (bộ điều phối chỉ ghi "lẽ ra chạy", đường cũ vẫn mở lượt), chưa nối repo ⇒ bỏ qua. */
export const emitFlow = async (
  r: ContractFlowTxRepos,
  prep: FlowPrep | undefined,
  ev: Exclude<ContractEvent, "contract.uploaded">,
  ids: [contractId: string, approvalId: string],
  actor: string,
): Promise<void> => {
  if (!prep || !flowEmits(prep)) return;
  const repo = prep.on ? requireFlow(r) : r.contractFlow;
  if (!repo) return;
  const o = { actor, departments: prep.departments };
  await emitGuarded(repo, prep.on, ev, (x) => x.emitContract(ev, ids[0], ids[1], o));
};

/** `contract.uploaded` CÙNG tx tải lên (cùng luật cờ như `emitFlow`). */
export const emitUploadedFlow = async (
  r: ContractFlowTxRepos,
  prep: FlowPrep,
  contractId: string,
  fileType: string,
  actor: string,
): Promise<void> => {
  if (!flowEmits(prep)) return;
  const repo = prep.on ? requireFlow(r) : r.contractFlow;
  const o = { fileType, actor, departments: prep.departments };
  if (repo)
    await emitGuarded(repo, prep.on, "contract.uploaded", (x) => x.emitUploaded(contractId, o));
};

/** Cờ bật ⇒ chạy thẳng (lỗi làm hỏng tx); cờ tắt ⇒ trong savepoint (lỗi bóng không làm hỏng tx ghi hợp đồng). */
export const emitGuarded = (
  repo: ContractFlowRepo,
  on: boolean,
  event: string,
  fn: (repo: ContractFlowRepo) => Promise<unknown>,
): Promise<unknown> => (on || !repo.shadow ? fn(repo) : repo.shadow(event, fn));

/** Bắn trong tx đang mở; cờ bật mà repo chưa nối ⇒ ném (không im lặng nuốt sự kiện). */
export function requireFlow(r: ContractFlowTxRepos): ContractFlowRepo {
  if (!r.contractFlow) throw new Error("contract flow repo missing");
  return r.contractFlow;
}
