// contract-flow S3a · cổng CỤC BỘ của gói tới engine quy trình cho duyệt HĐ (lớp 2 — chỉ kiểu). Chỉ các hàm gói cần; nối vào cổng
// kit `PackRunsPort` (S1a: ensureDef / start có ref / cancel / passedStages / lastApprover) bằng một adapter mỏng lúc mount.
// Repo `approvalEngine` chạy trong tx `PackUow` (role `contracts_rw`, RLS FORCE) + `tenant_id` tường minh; mỗi hàm MỘT câu.
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type {
  PackActTarget,
  PackOpenTask,
  PackReviewAct,
  PackRunOutcomeSys,
  PackStepsView,
} from "../../kit/application/pack-runs.ports";
import type { PackUow } from "../../kit/application/ports";
import type { FlowStep } from "../domain/approval-flow.types";
import type { ApprovalFlowRepo } from "./approval-flow.usecase";
import type { ProductLinksRepo } from "./product-links.usecase";

/** Người gọi = user JWT (cấu trúc khớp `PackRunCaller`). */
export type EngineCaller = { userId: string; tenantId: string; role: string };
export type EngineRunRef = { pack: string; record_id: string };
export type EngineStartRequest = {
  process_key: string;
  input: string;
  inputs: { type: "text"; key: string; text: string }[];
  ref: EngineRunRef;
};

export type ApprovalEnginePort = {
  /** Đẩy def (tenant người gọi) khi `version` khác bản engine đang giữ; trùng ⇒ không làm gì. */
  ensureDef(
    u: EngineCaller,
    key: string,
    def: Record<string, unknown>,
    version: number,
  ): Promise<unknown>;
  /** Mở run (COMMIT, CHƯA kick) gắn `ref` (pack_ref); người gọi `kick()` sau khi gắn run vào HĐ. */
  start(
    u: EngineCaller,
    req: EngineStartRequest,
  ): Promise<{ runId: string; kick(): Promise<void> }>;
  /** Huỷ bù khi gắn run vào bản ghi gói thất bại. */
  cancel(u: EngineCaller, runId: string): Promise<void>;
  /** Khoá stage review đã Đạt (lần quyết gần nhất mỗi stage là pass) của run thuộc tenant. */
  passedStages(tenantId: string, runId: string): Promise<string[]>;
  /** Người Đạt review gần nhất của run (null khi chưa có). */
  lastApprover(tenantId: string, runId: string): Promise<string | null>;
  /** S3b · quyết task duyệt mở của run (scope user người quyết); không có task mở ⇒ "not_open". */
  act(
    u: EngineCaller,
    runId: string,
    at: PackActTarget,
    b: PackReviewAct,
  ): Promise<"ok" | "not_open">;
  /** S3b · huỷ run ở scope system ("Đọc lại"); đã kết thúc / không có ⇒ false. */
  cancelSys(tenantId: string, runId: string): Promise<boolean>;
  /** S3b · dòng thời gian stage cho người xem (≤ 2 câu SQL); không thấy run ⇒ null. */
  stepsView(u: EngineCaller, runId: string): Promise<PackStepsView | null>;
  /** S3b · kết quả nhiều run (scope system, một câu lọc tenant). */
  outcomesOf(
    tenantIds: string | readonly string[],
    runIds: readonly string[],
  ): Promise<PackRunOutcomeSys[]>;
  /** S3b · "Việc của tôi": task duyệt mở của run gói `packKey` mà người gọi quyết được. */
  openTasksOf(u: EngineCaller, packKey: string): Promise<PackOpenTask[]>;
};
/** Cầu nối dựng lúc mount; engine tắt ⇒ `port` vắng. */
export type ApprovalEngineBridge = { port?: ApprovalEnginePort };

/** Lượt duyệt engine của HĐ đọc theo `engine_run_id` (tool) — HĐ + facts + mẫu chụp + gắn SP chờ. */
export type EngineRunRow = {
  contractId: string;
  approvalId: string;
  approvalStatus: string;
  contractStatus: string;
  deal: string | null;
  totalValue: unknown;
  flowSteps: FlowStep[];
  pendingLinks: unknown[] | null;
};
/** Lượt hiện tại của HĐ lúc mở run engine. */
export type EngineStartRow = {
  approvalId: string | null;
  approvalStatus: string | null;
  mode: string | null;
  engineRunId: string | null;
};
export type ApprovalEngineRepo = {
  /** Lượt engine có `engine_run_id = runId` của tenant (`lock` ⇒ FOR UPDATE HĐ); không có ⇒ null. */
  byRun(runId: string, o: { lock: boolean }): Promise<EngineRunRow | null>;
  /** HĐ của tenant + lượt đang gắn; không thấy HĐ ⇒ null. */
  startState(contractId: string): Promise<EngineStartRow | null>;
  /** Gắn run: lượt `level1` chế độ máy chưa có run ⇒ `engine` + `engine_run_id` + `flow_version` + `flow_steps`. */
  attach(
    contractId: string,
    approvalId: string,
    a: { runId: string; version: number; steps: readonly FlowStep[] },
  ): Promise<boolean>;
  /** `needs_review → active` + `confirmed_*` + event `approved` + lượt `done` (chỉ HĐ của run engine). */
  finalize(
    contractId: string,
    approvalId: string,
    runId: string,
    by: string | null,
  ): Promise<boolean>;
  /** S3b · lưu gắn SP chờ (duyệt cuối) cho lượt engine còn `level1`; áp trong tx `finalize` của tool. */
  setPendingLinks(approvalId: string, runId: string, links: readonly unknown[]): Promise<boolean>;
  /** S3b · nhãn HĐ (số, tiêu đề) của các HĐ người dùng THẤY (RLS M1) — MỘT câu `= any`. */
  labels(
    ids: readonly string[],
  ): Promise<{ id: string; number: string | null; title: string | null }[]>;
};

export type ApprovalEngineTxRepos = {
  approvalEngine: ApprovalEngineRepo;
  approvalFlow: ApprovalFlowRepo;
  links?: ProductLinksRepo;
} & KitTxRepos;
export type ApprovalEngineUow = PackUow<ApprovalEngineTxRepos>;
