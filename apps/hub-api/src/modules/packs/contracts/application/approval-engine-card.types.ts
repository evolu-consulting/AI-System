// CR-127 R1 #3 · tách từ approval-engine-card.usecase.ts: kiểu cổng/phụ thuộc/body của thẻ duyệt engine.
import type { PackWho } from "../../kit/public";
import type { EngineAction, EngineErrorCode } from "../domain/approval-engine-act.rules";
import type { ApprovalEnginePort, ApprovalEngineRepo } from "./approval-engine.ports";
import type { EvidenceFile } from "./approval-record.usecase";

/** CR-127 · E4b · cổng đọc byte một tệp của bằng chứng (tenant, evidenceId, fileId) ⇒ null nếu không thuộc bằng chứng đó. */
export type EvidenceBytes = (
  tenantId: string,
  evidenceId: string,
  fileId: string,
) => Promise<EvidenceFile | null>;

/** CR-127 · U4b-3 · tên tệp/chữ ký của các bằng chứng (`fileId → tên`) cho PDF Hồ sơ duyệt; một câu theo lô. */
export type EvidenceNames = (
  tenantId: string,
  evidenceIds: readonly string[],
) => Promise<Map<string, { name: string; mime: string }>>;

/** CR-181 · s10 · ảnh chữ ký đã in (`hub.user_signatures.png`) theo id; id không thuộc tenant ⇒ không có trong kết quả. */
export type StampPng = (
  tenantId: string,
  ids: readonly string[],
) => Promise<Map<string, Uint8Array>>;

export type Repos = {
  approval: {
    markRejected(
      id: string,
      runId: string,
      e: { kind: "rejected"; feedback: string | null; actor: string },
      o?: { reviewer?: boolean },
    ): Promise<boolean>;
    markExtracting(id: string, runId: string): Promise<boolean>;
    /** CR-109 · khoá theo luật thấy cũ (không cờ duyệt): null ⇒ người gọi chỉ là người duyệt ngoài cây. */
    state(id: string, o: { lock: boolean }): Promise<unknown>;
  };
  approvalEngine: Pick<
    ApprovalEngineRepo,
    | "setPendingLinks"
    | "recordOverride"
    | "voidOverride"
    | "recordDecision"
    | "decisionsOf"
    | "signsOf"
    | "savedRecord"
  > & {
    difyFacts?: ApprovalEngineRepo["difyFacts"];
    labels?: ApprovalEngineRepo["labels"];
  };
  outbox: { enqueue(e: { entity: string; entity_id: string; op: "upsert" }[]): Promise<unknown> };
};
export type EngineCardDeps = {
  port: () => ApprovalEnginePort | undefined;
  /** esign-flow-fix · người xem là owner gói (quyền `admin`, cache — 0 SQL). */
  isAdmin?: ((who: PackWho) => Promise<boolean>) | undefined;
  /** CR-127 · E4b · đọc byte tệp/chữ ký của bằng chứng (cổng hub tiêm); vắng ⇒ route tải tệp bằng chứng 404. */
  evidenceBytes?: EvidenceBytes | undefined;
  evidenceNames?: EvidenceNames | undefined;
  /** CR-181 · s10 · ảnh chữ ký đã in theo id (hub, một câu theo lô; chỉ id thuộc tenant). Vắng ⇒ không có ảnh. */
  stampPng?: StampPng | undefined;
  /** CR-181 · s10 · đọc byte PDF hồ sơ đã lưu ở FileBox (org, fileId). */
  savedBytes?: ((org: string, fileId: string) => Promise<Uint8Array | null>) | undefined;
  /** CR-181 · s10 · tên người ký chưa có trong hồ sơ (người không có bước duyệt). */
  userNames?:
    | ((who: PackWho, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>)
    | undefined;
  uow: { tenant<T>(who: PackWho, fn: (r: Repos) => Promise<T>): Promise<T> };
  jobs: {
    enqueue(j: {
      tenantId: string;
      userId: string;
      contractId: string;
      approvalId: string | null;
    }): Promise<void>;
  };
  redo?: { ready: boolean; quota: (tenantId: string) => Promise<void> } | undefined;
  /** CR-113 · tên Group (cho `escalated_to`); vắng ⇒ không hiện tên. Chỉ gọi khi có bước đã chuyển cấp. */
  groupNames?: ((tenantId: string) => Promise<{ id: string; name: string }[]>) | undefined;
  /** CR-113 · giờ server (`overdue`); vắng ⇒ `new Date()`. */
  now?: () => Date;
  warn?: (msg: string, meta: Record<string, unknown>) => void;
};
export type EngineActBody = {
  action: EngineAction;
  feedback?: string | undefined;
  products?: readonly unknown[] | undefined;
  /** CR-127 · E4 · bằng chứng của quyết định (engine ghi cùng tx đóng task). */
  evidence?:
    | { note: string; signature_attachment_id?: string; attachment_ids?: string[] }
    | undefined;
  /** CR-120 · task người bấm thấy (FlowRuntime.act); khác task engine định quyết ⇒ APPROVAL_NOT_OPEN (bấm lại không quyết bước kế). */
  expect?: { taskId: string } | undefined;
};
export type EngineActResult = "ok" | "unavailable" | { error: EngineErrorCode };
