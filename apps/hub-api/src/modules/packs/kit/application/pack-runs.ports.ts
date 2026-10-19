// N2-FR-01 · N2-D04 · N2-D08 · plan N2 §1–§2: cổng khởi chạy run quy trình TRONG cùng process cho gói (không HTTP nội bộ,
// PK-BR-01). Lớp 2 — chỉ kiểu. Engine quy trình (`processes`) cài đặt và gắn vào cầu nối `PackRunsBridge` lúc mount; engine
// tắt ⇒ cầu rỗng (gói trả 503 `PROCESS_ENGINE_OFF`).

/** Người gọi = user của JWT (cấu trúc khớp `AuthUser`). */
export type PackRunCaller = { userId: string; tenantId: string; role: string };

/** = `POST /process-runs` bỏ `origin` (origin none). */
export type PackRunRequest = { process_key: string; input: string; inputs?: unknown[] };

export type PackRunOutcome = {
  run_id: string;
  status: string;
  /** N2-FR-02 · có task duyệt kết quả `reject`. */
  rejected: boolean;
  /** Lý do Từ chối (null khi không bị từ chối). */
  feedback: string | null;
};

/** HD3 · #219 · một lượt agent KHÔNG tool trên `hub.runs` đang chạy của stage tool gọi (id từ `PackToolCtx.runId`). */
export type PackAgentRequest = {
  hubRunId: string;
  tenantId: string;
  /** Khoá agent (`hub.agents.key`, runtime agentic-cli). */
  agentKey: string;
  system: string;
  prompt: string;
  signal: AbortSignal;
};
export type PackAgentReply =
  | { ok: true; text: string }
  | { ok: false; code: "AGENT_UNAVAILABLE" | "AGENT_FAILED" | "TIMEOUT" };

/** HD3 · trạng thái run của bản ghi gói cho người xem (task duyệt đang mở + `can_act` theo luật engine). */
export type PackRunState = {
  run_id: string;
  status: string;
  /** Khoá stage hiện tại (snapshot). */
  stage_key: string | null;
  task: { id: string; can_act: boolean } | null;
  rejected: boolean;
  feedback: string | null;
};
/** HD3 · quyết task duyệt đang mở của run (= `POST /review-tasks/:id/decision`). */
export type PackReviewAct = { result: "pass" | "fail" | "reject"; feedback?: string };
export type PackRunOutcomeSys = PackRunOutcome & { tenant_id: string };

export type PackRunsPort = {
  /** HD3 · D3-05 · tạo def tenant nếu khoá chưa có (cùng luật lưu def); `sync` ⇒ def đã có: ghi đè bằng def gói (cài đặt
   *  tenant đổi — D3-12; sửa tay ở editor bị thay). Def không hợp lệ ⇒ ném (lỗi lập trình gói). */
  ensureDef(
    u: PackRunCaller,
    def: { key: string } & Record<string, unknown>,
    o?: { sync?: boolean },
  ): Promise<"created" | "exists" | "synced">;
  /** HD3 · #219 · agent không tool chạy như job của stage tool đang chạy (kiểm hub run `running` + đúng tenant). */
  agent(req: PackAgentRequest): Promise<PackAgentReply>;
  /** HD3 · trạng thái run (scope user người xem, 2 câu); run không thấy ⇒ null. */
  state(u: PackRunCaller, runId: string): Promise<PackRunState | null>;
  /** HD3 · quyết task duyệt đang mở; không có ⇒ `not_open`. Lỗi quyền/lý do của engine ném như route engine. */
  act(u: PackRunCaller, runId: string, b: PackReviewAct): Promise<"ok" | "not_open">;
  /** HD3 · vòng quét gói: kết quả nhiều run, scope system, lọc `tenant_id = any` + `id = any` (MỘT câu). */
  outcomesOf(tenantIds: readonly string[], runIds: readonly string[]): Promise<PackRunOutcomeSys[]>;
  /** HD3 · người Đạt task duyệt gần nhất của run (ghi `confirmed_by`); không có ⇒ null. */
  lastApprover(tenantId: string, runId: string): Promise<string | null>;
  /** HD3 · D3-12 · id Group (`admin.groups`) của tenant theo khoá; khoá không có ⇒ vắng trong map. */
  groupIdsOf(tenantId: string, keys: readonly string[]): Promise<Map<string, string>>;
  /** Mở run (kiểm def bật + Group chạy + trần + inputs) và COMMIT nhưng CHƯA kick; người gọi `kick()` sau khi gắn run. */
  start(u: PackRunCaller, req: PackRunRequest): Promise<{ runId: string; kick(): Promise<void> }>;
  /** Huỷ bù khi gắn run vào bản ghi gói thất bại (người bắt đầu được huỷ run của mình). */
  cancel(u: PackRunCaller, runId: string): Promise<void>;
  /** N2-D08 · kết quả các run (tenant người gọi; MỘT câu `= any`). Security L3: gói CHỈ gọi qua `ownedRunOutcome`
   *  (id run đọc từ bản ghi của gói), không truyền id tuỳ ý. */
  outcomes(u: PackRunCaller, runIds: readonly string[]): Promise<PackRunOutcome[]>;
};

/** Cầu nối dựng ở `app.ts`, engine gắn khi mount (khuôn `ResolveBridge`). */
export type PackRunsBridge = { port?: PackRunsPort };
