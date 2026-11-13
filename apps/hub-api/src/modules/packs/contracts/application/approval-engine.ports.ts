// contract-flow S3a · cổng CỤC BỘ của gói tới engine quy trình cho duyệt HĐ (lớp 2 — chỉ kiểu). Chỉ các hàm gói cần; nối vào cổng
// kit `PackRunsPort` (S1a: ensureDef / start có ref / cancel / passedStages / lastApprover) bằng một adapter mỏng lúc mount.
// Repo `approvalEngine` chạy trong tx `PackUow` (role `contracts_rw`, RLS FORCE) + `tenant_id` tường minh; mỗi hàm MỘT câu.
import type {
  EventFlow,
  KitTxRepos,
  PackActTarget,
  PackDecided,
  PackDecidedTask,
  PackOpenRun,
  PackOpenTask,
  PackReviewAct,
  PackRunOutcomeSys,
  PackStepsView,
  PackUow,
  PackWorkflow,
  ResolvedSlot,
  RoutedSlot,
  RouteSlotFacts,
} from "../../kit/public";
import type { FlowStep } from "../domain/approval-flow.types";
import type { ApprovalFlowRepo } from "./approval-flow.ports";
import type { ContractFlowTxRepos } from "./contract-flow.ports";
import type { ProductLinksRepo } from "./product-links.usecase";

/** Người gọi = user JWT (cấu trúc khớp `PackRunCaller`). */
export type EngineCaller = { userId: string; tenantId: string; role: string };
export type EngineRunRef = { pack: string; record_id: string };
export type EngineStartRequest = {
  process_key: string;
  input: string;
  inputs: (
    | { type: "text"; key: string; text: string }
    | { type: "number"; key: string; value: string }
    | { type: "date"; key: string; value: string } // CR-121 D-6 · ngày HĐ cho bước Chờ tới
  )[];
  ref: EngineRunRef;
  /** CR-105 · run theo khe: engine kiểm def run mang đúng `source_ref` + ghi tên/bản quy trình vào snapshot run. */
  slot?: {
    source_ref: string;
    process_name: string;
    rel_version: number;
    /** CR-118 §11.2 · def thư viện + luật đã khớp (chốt vào snapshot run). */
    process_def_id?: string;
    route_rule_id?: string | null;
  };
};

export type ApprovalEnginePort = {
  /** Đẩy def (tenant người gọi) khi `version` khác bản engine đang giữ; trùng ⇒ không làm gì. CR-105 · `{sourceRef}` ⇒ so bằng. */
  ensureDef(
    u: EngineCaller,
    key: string,
    def: Record<string, unknown>,
    version: number | { sourceRef: string },
  ): Promise<unknown>;
  /** CR-105 · quy trình đang chạy của khe cho tenant (gán ⇒ mặc định ⇒ bản xuất bản); vắng/không có ⇒ đường cũ `readFlow`. */
  resolveSlot?(tenantId: string, slot: string): Promise<ResolvedSlot | null>;
  /** CR-125 · S2 · flow Bật của công ty cho sự kiện (cùng nguồn tab Quy trình). */
  eventFlow?(tenantId: string, event: string): Promise<EventFlow | null>;
  /** CR-118 §11.2 · chọn quy trình theo luật phòng ban của người khởi tạo; vắng ⇒ `resolveSlot`. */
  routeSlot?(
    tenantId: string,
    slot: string,
    userId: string,
    facts?: RouteSlotFacts,
  ): Promise<RoutedSlot | null>;
  /** CR-105 · `source_ref` (sha256 16 hex) của def đã biên dịch — engine tính (lớp 1–2 gói không dùng `node:*`). */
  sourceRefOf?(def: Record<string, unknown>): string;
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
  /** CR-121 F-5 · input run theo HĐ đã xác nhận/sửa (CAS theo `version` HĐ); vắng ⇒ không cập nhật. */
  updateInputs?(
    r: { tenantId: string; runId: string; pack: string; recordId: string; version: number },
    patch: readonly (
      | { type: "text"; key: string; text: string }
      | { type: "number" | "date"; key: string; value: string }
    )[],
  ): Promise<boolean>;
  /** S3b · dòng thời gian stage cho người xem (≤ 2 câu SQL); không thấy run ⇒ null. */
  stepsView(u: EngineCaller, runId: string): Promise<PackStepsView | null>;
  /** S3b · kết quả nhiều run (scope system, một câu lọc tenant). */
  outcomesOf(
    tenantIds: string | readonly string[],
    runIds: readonly string[],
  ): Promise<PackRunOutcomeSys[]>;
  /** [AUDIT] · đối soát lịch sử quyết định (vắng ⇒ bỏ qua). */
  decidedTasksOf?(tenantId: string, runIds: readonly string[]): Promise<PackDecidedTask[]>;
  /** S3b · "Việc của tôi": task duyệt mở của run gói `packKey` mà người gọi quyết được. */
  openTasksOf(u: EngineCaller, packKey: string): Promise<PackOpenTask[]>;
  /** cf-dify · workflow catalog mà tenant được dùng (cho bước Dify). */
  workflowsOf(tenantId: string): Promise<PackWorkflow[]>;
  /** CR-107 · "Thử lại" run `needs_decision` (`add_attempt` của engine; gói đã kiểm quyền admin). Vắng ⇒ không hỗ trợ. */
  retryDecision?(u: EngineCaller, runId: string): Promise<"ok" | "not_open">;
  /** CR-107 · run gói chưa kết thúc bắt đầu trước `before` (dọn run mồ côi). Vắng ⇒ bỏ bước dọn. */
  openPackRuns?(
    tenantId: string,
    packKey: string,
    before: Date,
    limit: number,
  ): Promise<PackOpenRun[]>;
};
/** Cầu nối dựng lúc mount; engine tắt ⇒ `port` vắng. */
export type ApprovalEngineBridge = {
  port?: ApprovalEnginePort;
  /** [AUDIT] · cầu `packRuns`: gói HĐ gắn `onDecided.contracts` (ghi `stage_decided` cho quyết đi đường chung). */
  onDecided?: Partial<Record<string, (e: PackDecided) => Promise<void>>>;
};

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
  /** Người bắt đầu lượt (run mở luôn mang người này — không phải người kích job/Đọc lại). */
  startedBy: string | null;
  /** cr118-route-kind · loại HĐ (`contracts.deal`: buy|sell|referral|null) — điều kiện luật chọn quy trình. Vắng ⇒ không biết. */
  deal?: string | null;
};
/** cf-dify · dữ liệu HĐ gửi workflow Dify (`openRun` điền input run). */
export type EngineDifyFacts = {
  title: string;
  deal: string | null;
  totalValue: unknown;
  partner: string;
  /** CR-121 D-6 · số HĐ, người phụ trách, ngày hết hạn / hạn xử lý (YYYY-MM-DD) cho bước Thông báo / Chờ tới. */
  number?: string | null;
  owner?: string | null;
  endDate?: string | null;
  actionDeadline?: string | null;
  /** CR-121 F-5 · `contracts.version` (CAS khi cập nhật input run). */
  version?: number;
};
/** CR-107 · một lần bấm Đạt duyệt cuối: `claim` = mã ngẫu nhiên của lần bấm, `by` = người, `task` = task duyệt đang mở. */
export type PendingLinksOwner = { claim: string; by: string; task: string };
/** CR-113 · một lần chủ gói "duyệt thay" bước không thuộc mình. */
export type OverrideEvent = {
  runId: string;
  taskId: string;
  stageKey: string;
  action: string;
  actor: string;
};
/** CR-125 · một quyết định của người duyệt trên một bước. */
export type DecisionEvent = {
  taskId: string;
  stageKey: string;
  action: "approve" | "return" | "reject";
  feedback: string | null;
  actor: string;
  /** CR-127 · E4 · id `hub.evidence` của quyết định (nếu có). */
  evidenceId?: string | null;
  /** [AUDIT] · lúc quyết (ghi bù của vòng đối soát); vắng ⇒ now(). */
  at?: string;
};
/** CR-127 · E4 · một dòng hồ sơ duyệt (chưa lọc BR-26 — usecase lọc). */
export type DecisionRow = {
  taskId: string;
  stage: string;
  action: "approve" | "return" | "reject";
  at: string;
  actor: string;
  feedback: string | null;
  /** [AUDIT] · Toàn quyền duyệt thay (không phải người/nhóm được giao). */
  override: boolean;
  evidence: {
    id: string;
    note: string;
    signature_attachment_id: string | null;
    attachment_ids: string[];
    by_user: string;
    on_behalf_of: string | null;
    at: string;
  } | null;
};
export type PendingLinksOp =
  | (PendingLinksOwner & { links: readonly unknown[] | null })
  | (PendingLinksOwner & { release: true });
export type ApprovalEngineRepo = {
  /** cf-dify · tiêu đề, loại, giá trị, đối tác của HĐ (một câu); không thấy ⇒ null. */
  difyFacts(contractId: string): Promise<EngineDifyFacts | null>;
  /** Lượt engine có `engine_run_id = runId` của tenant (`lock` ⇒ FOR UPDATE HĐ); không có ⇒ null. */
  byRun(runId: string, o: { lock: boolean }): Promise<EngineRunRow | null>;
  /** HĐ của tenant + lượt đang gắn; không thấy HĐ ⇒ null. */
  startState(contractId: string): Promise<EngineStartRow | null>;
  /** Gắn run (khoá HĐ FOR UPDATE trước): lượt `level1` chế độ máy chưa có run ⇒ `engine` + `engine_run_id` + `flow_version` +
   *  `flow_steps`; `replaces` ⇒ mở lại: lượt `engine` đang giữ run `replaces` (đã kết thúc bất thường) đổi sang run mới. */
  attach(
    contractId: string,
    approvalId: string,
    a: { runId: string; version: number; steps: readonly FlowStep[]; replaces?: string | null },
  ): Promise<boolean>;
  /** CR-107 · lượt `level1` KẸT với lý do `reason` (→ `feedback`): `runId` null ⇒ lượt chưa có run ⇒ `mode='engine'`; có ⇒ lượt
   *  engine đang giữ đúng run đó. Khoá HĐ trước (như `attach`). Không khớp ⇒ false. */
  markStalled(
    contractId: string,
    approvalId: string,
    s: { runId: string | null; reason: string },
  ): Promise<boolean>;
  /** `processing → done` + `confirmed_*` + event `approved` + lượt `done` (chỉ HĐ của run engine). */
  finalize(
    contractId: string,
    approvalId: string,
    runId: string,
    by: string | null,
  ): Promise<boolean>;
  /** S3b · lưu gắn SP chờ (duyệt cuối) cho lượt engine còn `level1`; áp trong tx `finalize` của tool.
   *  CR-107 · `links` ⇒ GIỮ chỗ (một người một lúc trên cùng task): false khi người khác đang giữ task đó (chưa quá hạn);
   *  `release` ⇒ trả chỗ CHỈ khi vẫn đúng lần giữ `claim` của mình (so-rồi-xoá). */
  setPendingLinks(approvalId: string, runId: string, p: PendingLinksOp): Promise<boolean>;
  /** CR-113 · ghi "duyệt thay" (`contract_events` `approval_override`: lượt, run engine, task, stage, hành động) — MỘT câu. */
  recordOverride?(contractId: string, approvalId: string, e: OverrideEvent): Promise<string | null>;
  /** CR-113 (review) · bù trừ: xoá bản ghi "duyệt thay" vừa chèn (id) khi engine không nhận quyết. */
  voidOverride?(eventId: string): Promise<boolean>;
  /** CR-125 · nhật ký MỖI quyết định của người duyệt trên bước của run engine (`contract_events` `stage_decided`: người, bước,
   *  approve|return|reject, góp ý) — hiện ở lịch sử HĐ. MỘT câu. */
  recordDecision?(contractId: string, approvalId: string, e: DecisionEvent): Promise<void>;
  /** CR-127 · E4 · hồ sơ duyệt: mọi `stage_decided` của HĐ (≤ 200, theo thời gian) + bằng chứng qua `hub.evidence_get` — MỘT câu. */
  decisionsOf?(contractId: string): Promise<DecisionRow[]>;
  /** S3b · nhãn HĐ (số, tiêu đề) của các HĐ người dùng THẤY (RLS M1) — MỘT câu `= any`. */
  labels(
    ids: readonly string[],
  ): Promise<{ id: string; number: string | null; title: string | null }[]>;
};

/** CR-121 D-1 · dữ kiện "đối tác mới" của HĐ (MỘT câu, tx gói): chưa có khoá đối tác ⇒ null (chưa có dữ liệu). */
export type FlowFactsRepo = { newPartner(contractId: string): Promise<boolean | null> };
/** CR-121 D-1 · mã Group phòng ban của user + mọi phòng cha (MỘT câu, scope system hub, ngoài tx gói); không có ⇒ []. */
export type CreatorDepartments = (tenantId: string, userId: string) => Promise<readonly string[]>;

export type ApprovalEngineTxRepos = {
  approvalEngine: ApprovalEngineRepo;
  approvalFlow: ApprovalFlowRepo;
  links?: ProductLinksRepo;
  /** CR-121 D-1 · vắng ⇒ `new_partner` chưa có dữ liệu (bước có điều kiện đó vẫn chạy). */
  flowFacts?: FlowFactsRepo;
} & KitTxRepos &
  ContractFlowTxRepos;
export type ApprovalEngineUow = PackUow<ApprovalEngineTxRepos>;
