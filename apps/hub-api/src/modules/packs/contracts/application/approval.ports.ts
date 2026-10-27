// HD-FR-31…37 · M3-decouple: cổng của flow duyệt HĐ trong gói (lớp 2 — chỉ kiểu). Repo chạy trong tx `PackUow` (role
// `contracts_rw`, RLS tenant); mỗi hàm MỘT câu. Lượt duyệt = hàng `contracts.approvals`; HĐ trỏ lượt hiện tại qua `run_id`.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow } from "../../kit/application/ports";
import type { ApprovalSettings } from "../domain/approval-def.rules";
import type { FlowStep } from "../domain/approval-flow.types";
import type { ProductLinksRepo } from "./product-links.usecase";

export type ContractRunRef = {
  runId: string | null;
  status: string;
  hasSource: boolean;
  version: number;
};
/** HĐ + lượt duyệt hiện tại + giá trị + ngưỡng tenant (MỘT câu; `lock` ⇒ FOR UPDATE HĐ). */
export type ApprovalState = ContractRunRef & {
  /** `mode` (contract-flow S3a): `engine` ⇒ lượt chạy trên engine — máy cũ không quyết (S3b mở API act cho engine). */
  approval: {
    id: string;
    status: string;
    startedBy: string;
    feedback: string | null;
    mode?: string;
    /** S3b · lượt `mode = 'engine'`: run engine + mẫu chụp lúc mở run. */
    engineRunId?: string | null;
    flowSteps?: FlowStep[] | null;
    /** esign-flow · trạng thái + lý do bước Ký số của lượt (null = chưa tới / không có). */
    esignStatus?: string | null;
    esignReason?: string | null;
    /** esign-flow-fix · `sending` kẹt quá hạn (Gửi lại được). */
    esignStale?: boolean;
    /** esign-sweep2 · mốc lần gửi hiện tại + lần nhắc cuối (ISO UTC) ⇒ hạn ký / quá hạn / đã nhắc trên thẻ. */
    esignAt?: string | null;
    esignRemindedAt?: string | null;
  } | null;
  /** esign-flow · người phụ trách HĐ (`owner_user_id`) — quyền "Gửi lại" bước Ký số. */
  owner?: string | null;
  /** S3b · loại HĐ (facts rẽ/`finalizes_on_approve`). */
  deal?: string | null;
  value: unknown;
  threshold: number;
};
export type OpenOutcome = "ok" | "not_found" | "busy";
export type RejectEvent = {
  kind: "rejected" | "cancelled";
  feedback: string | null;
  actor: string | null;
};

export type ApprovalRepo = {
  /** HĐ của tenant: lượt đang gắn + trạng thái; không có ⇒ null. */
  runOf(id: string): Promise<ContractRunRef | null>;
  state(id: string, o: { lock: boolean }): Promise<ApprovalState | null>;
  /** Mở lượt duyệt mới (`extracting` khi có việc AI đọc, `level1` khi nhập tay/mở lại) + gắn `run_id` + event
   *  `approval_started`; HĐ đã có lượt sống ⇒ `busy`. */
  open(
    id: string,
    approvalId: string,
    actor: string,
    initial: "extracting" | "level1",
  ): Promise<OpenOutcome>;
  /** Cấp 1 Xác nhận mà giá trị cần cấp 2 ⇒ lượt `level2` + `level1_by/at`. */
  toLevel2(approvalId: string, actor: string): Promise<boolean>;
  /** `needs_review → active` + `confirmed_*` + event `approved` + lượt `done` (chỉ HĐ của lượt); giá trị cần cấp 2 mà
   *  `!level2Passed` ⇒ 0 hàng (luật kiểm TRONG câu UPDATE, D3-14). */
  finalize(id: string, runId: string, by: string | null, level2Passed: boolean): Promise<boolean>;
  /** Từ chối / huỷ ⇒ HĐ `rejected` + event + lượt `rejected`/`cancelled` (chỉ khi HĐ còn giữ lượt và chưa kết thúc). */
  markRejected(id: string, runId: string, e: RejectEvent): Promise<boolean>;
  /** Trích lại ở bước mở: HĐ `needs_review → extracting`, lượt → `extracting`. */
  markExtracting(id: string, runId: string): Promise<boolean>;
  /** Sau lượt AI: lượt `extracting` ⇒ `level1` (HĐ needs_review) / `failed` (extract_failed). Trả trạng thái mới hoặc null. */
  afterExtraction(id: string, runId: string): Promise<string | null>;
  /** Worker bắt đầu lượt đọc: lượt hết xếp hàng (`queued_at = null`) + HĐ `updated_at = now()`; false ⇒ lượt/HĐ không còn
   *  `extracting`. */
  markStarted(id: string, runId: string): Promise<boolean>;
  /** Trạng thái lượt duyệt (luật sửa trường); không có ⇒ null. */
  statusOf(runId: string): Promise<string | null>;
  /** fix-review · run engine của lượt (`mode = 'engine'`); máy cũ / không có ⇒ null — luật sửa trường theo bước đang mở. */
  engineRunOf(runId: string): Promise<string | null>;
  settings(): Promise<ApprovalSettings>;
  saveSettings(s: ApprovalSettings, actor: string): Promise<ApprovalSettings>;
};

export type SweepOptions = {
  /** HĐ `extracting` mà job đã chạy (hoặc không có lượt xếp hàng): quá hạn tính từ `updated_at` (worker chạm lúc bắt đầu). */
  staleMinutes: number;
  /** Job còn xếp hàng (lượt `queued_at` có giá trị, worker chưa nhận): chỉ đóng khi chờ quá mức này (entry Redis bị mất). */
  queuedMinutes: number;
  limit: number;
};
/** S3b · HĐ vừa heal `extracting → level1` (mở run engine sau) — người mở = người bắt đầu lượt. */
export type HealedLevel1 = { contractId: string; userId: string };
export type SweepCounts = {
  read: number;
  closed: number;
  healed: number;
  healedLevel1?: HealedLevel1[];
};
/** S3b · lượt engine còn `level1` + run gắn (reconcile). */
export type EngineApprovalRef = { approvalId: string; runId: string };
/** S3b · việc đồng bộ một lượt (khớp theo CẢ lượt lẫn run): Từ chối ⇒ HĐ rejected; stalled ⇒ giữ engine, ghi lý do vào `feedback`. */
export type ReconcileItem =
  | { approvalId: string; runId: string; kind: "reject"; feedback: string | null }
  | { approvalId: string; runId: string; kind: "stalled"; reason: string };
export type SweepRepo = {
  /** S3b · MỘT câu: ≤ `limit` lượt `engine` còn `level1` (ngẫu nhiên — không đói khi > limit). */
  engineRuns(limit: number): Promise<EngineApprovalRef[]>;
  /** S3b · MỘT câu UPDATE theo tập (có điều kiện `mode='engine' + level1`; chạy lại vô hại). Trả (rejected, released). */
  reconcile(items: readonly ReconcileItem[]): Promise<{ rejected: number; stalled: number }>;
  /** MỘT câu: đọc HĐ trong flow (đếm có lượt) + HĐ `extracting` quá hạn ⇒ `extract_failed STALE` + event + lượt `failed` +
   *  lượt `extracting` mà HĐ đã xong lượt đọc (afterExtraction lỗi) ⇒ `level1`/`failed` (review B #12). */
  sweep(o: SweepOptions): Promise<SweepCounts>;
};

/** `links` (products-confirm): gắn/tạo SP ở bước duyệt cuối; vắng (test cũ) ⇒ bỏ qua. */
export type ApprovalTxRepos = { approval: ApprovalRepo; links?: ProductLinksRepo } & KitTxRepos;
export type ApprovalUow = PackUow<ApprovalTxRepos>;
