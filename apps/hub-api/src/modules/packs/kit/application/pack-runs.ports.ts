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

export type PackRunsPort = {
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
