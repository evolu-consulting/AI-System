// N2-FR-01 · N2-D04 · N2-D08 · plan N2 §1–§2: cổng khởi chạy run quy trình TRONG cùng process cho gói (không HTTP nội bộ,
// PK-BR-01). Lớp 2 — chỉ kiểu. Engine quy trình (`processes`) cài đặt và gắn vào cầu nối `PackRunsBridge` lúc mount; engine
// tắt ⇒ cầu rỗng (gói trả 503 `PROCESS_ENGINE_OFF`).
// contract-flow S1a · cầu v2: def gói (`ensureDef`), run gắn bản ghi gói (`ref`), quyết task (`act`, scope user ⇒ canAct/RLS
// của engine), đọc dòng thời gian (`stepsView`) + lời gọi hệ thống lọc tenant tường minh.

/** Người gọi = user của JWT (cấu trúc khớp `AuthUser`). */
export type PackRunCaller = { userId: string; tenantId: string; role: string };

/** contract-flow S1a · bản ghi gói của run (`hub.process_runs.pack_key/pack_record_id`; chỉ `start` ghi, không đổi). */
export type PackRunRef = { pack: string; record_id: string };

/** = `POST /process-runs` bỏ `origin` (origin none). */
export type PackRunRequest = {
  process_key: string;
  input: string;
  inputs?: unknown[];
  ref?: PackRunRef;
};

export type PackRunOutcome = {
  run_id: string;
  status: string;
  /** N2-FR-02 · có task duyệt kết quả `reject`. */
  rejected: boolean;
  /** Lý do Từ chối (null khi không bị từ chối). */
  feedback: string | null;
};
/** S1a · kết quả cho vòng quét gói (scope system) + tenant + khoá stage hiện tại. */
export type PackRunOutcomeSys = PackRunOutcome & { tenant_id: string; stage_key: string | null };

/** S1a · quyết task duyệt (= `POST /review-tasks/:id/decision`); `back_to_step` chỉ với `fail` (∈ `after.back_to_steps`). */
export type PackReviewAct = {
  result: "pass" | "fail" | "reject";
  feedback?: string;
  back_to_step?: number;
};
/** S1a · task duyệt đích: id task (của đúng run) hoặc khoá stage (task review đang mở của stage đó). */
export type PackActTarget = { task_id: string } | { stage: string };

/** S1a · trạng thái một stage cho thẻ duyệt của gói. */
export type PackStepStatus =
  | "pending"
  | "open"
  | "passed"
  | "skipped"
  | "returned"
  | "rejected"
  | "running" // cf-dify · bước Dify đang chạy
  | "failed"; // cf-dify · bước Dify lỗi hết lượt (needs_decision)
export type PackStepView = {
  idx: number;
  key: string;
  name: string;
  status: PackStepStatus;
  /** Group duyệt của stage (snapshot) — null khi stage không duyệt. */
  group_id: string | null;
  /** Group chuyển cấp đã thêm (null khi chưa chuyển cấp). */
  escalated_group_id: string | null;
  /** Hạn = mốc chuyển cấp của task duyệt gần nhất (`created_at + after_h`); null khi không có. */
  due_at: string | null;
  escalated: boolean;
  /** Quyết gần nhất của stage (task review). */
  result: "pass" | "fail" | "reject" | null;
  decided_by: { id: string; name: string } | null;
  decided_at: string | null;
  feedback: string | null;
  /** Task review đang mở + người xem quyết được không (`canAct` của engine). */
  task: { id: string; can_act: boolean } | null;
};
export type PackStepsView = {
  run_id: string;
  status: string;
  started_by: string;
  steps: PackStepView[];
};

/** contract-flow S1b · một task duyệt đang mở mà người gọi quyết được ("Việc của tôi"). */
export type PackOpenTask = {
  task_id: string;
  run_id: string;
  /** `pack_record_id` của run (bản ghi gói). */
  record_id: string;
  stage_key: string;
  stage_name: string;
  /** Hạn = mốc chuyển cấp của task; null khi stage không chuyển cấp. */
  due_at: string | null;
  escalated: boolean;
};

/** cf-dify · một workflow catalog cho gói: khoá, tên, tham số (`input_schema`). */
export type PackWorkflow = {
  key: string;
  name: string;
  params: {
    name: string;
    type: string;
    required: boolean;
    description?: string;
    options?: string[];
  }[];
};

export type PackRunsPort = {
  /** Mở run (kiểm def bật + Group chạy + trần + inputs) và COMMIT nhưng CHƯA kick; người gọi `kick()` sau khi gắn run.
   *  S1a · `ref` ⇒ ghi `pack_key/pack_record_id` cùng tx tạo run. */
  start(u: PackRunCaller, req: PackRunRequest): Promise<{ runId: string; kick(): Promise<void> }>;
  /** Huỷ bù khi gắn run vào bản ghi gói thất bại (người bắt đầu được huỷ run của mình). */
  cancel(u: PackRunCaller, runId: string): Promise<void>;
  /** N2-D08 · kết quả các run (tenant người gọi; MỘT câu `= any`). Security L3: gói CHỈ gọi qua `ownedRunOutcome`
   *  (id run đọc từ bản ghi của gói), không truyền id tuỳ ý. */
  outcomes(u: PackRunCaller, runIds: readonly string[]): Promise<PackRunOutcome[]>;
  /** S1a · tạo/đồng bộ def tenant `key` do gói sở hữu (cùng luật lưu def). Idempotent theo `version`: def đã đồng bộ
   *  version ≥ ⇒ "exists"; thấp hơn ⇒ ghi đè ("synced"). `u` = người thao tác (audit). Def sai ⇒ ném. */
  ensureDef(
    u: PackRunCaller,
    key: string,
    def: Record<string, unknown>,
    version: number,
  ): Promise<"created" | "exists" | "synced">;
  /** S1a · quyết task duyệt mở của run trong scope USER người quyết (canAct/RLS/exclude_starter của engine; lỗi ném như
   *  route engine). Không có task mở khớp ⇒ "not_open". */
  act(
    u: PackRunCaller,
    runId: string,
    at: PackActTarget,
    b: PackReviewAct,
  ): Promise<"ok" | "not_open">;
  /** S1a · huỷ run ở scope system (gói "Đọc lại"). Run không có trong tenant / đã kết thúc ⇒ false. */
  cancelSys(tenantId: string, runId: string): Promise<boolean>;
  /** S1a · kết quả nhiều run, scope system, MỘT câu lọc `tenant_id = any` + `id = any`. */
  outcomesOf(
    tenantIds: string | readonly string[],
    runIds: readonly string[],
  ): Promise<PackRunOutcomeSys[]>;
  /** S1a · khoá stage đã `done` mà quyết gần nhất của stage là Đạt (`pass` / decision `use_current`). */
  passedStages(tenantId: string, runId: string): Promise<string[]>;
  /** S1a · người Đạt task duyệt gần nhất của run; không có ⇒ null. */
  lastApprover(tenantId: string, runId: string): Promise<string | null>;
  /** S1a · id Group (`admin.groups`) của tenant theo khoá; khoá không có ⇒ vắng trong map. */
  groupIdsOf(tenantId: string, keys: readonly string[]): Promise<Map<string, string>>;
  /** S1a · dòng thời gian stage cho người xem (scope user, ≤ 2 câu SQL); run không thấy trong tenant ⇒ null. */
  stepsView(u: PackRunCaller, runId: string): Promise<PackStepsView | null>;
  /** cf-dify · workflow trong catalog mà tenant được dùng (`admin.workflows` enabled ∧ công tắc tenant còn hiệu lực),
   *  scope system, MỘT câu lọc `tenant_id` tường minh; ≤ 200, theo khoá. Không gồm tool của gói. */
  workflowsOf(tenantId: string): Promise<PackWorkflow[]>;
  /** S1b · task duyệt MỞ của run gói `packKey` (tenant người gọi) mà `u` quyết được — cùng luật `canAct` (Group duyệt,
   *  head_only, Group chuyển cấp, exclude_starter). MỘT câu SQL, scope user; thứ tự tạo task. */
  openTasksOf(u: PackRunCaller, packKey: string): Promise<PackOpenTask[]>;
};

/** Cầu nối dựng ở `app.ts`, engine gắn khi mount (khuôn `ResolveBridge`). */
export type PackRunsBridge = { port?: PackRunsPort };
