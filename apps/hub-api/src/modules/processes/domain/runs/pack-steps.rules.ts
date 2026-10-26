// contract-flow S1a · luật thuần: trạng thái từng stage cho thẻ duyệt của gói (`PackRunsPort.stepsView`) từ hàng stage +
// task review gần nhất của stage. Thứ tự ưu tiên: skipped → open (task mở) → passed (stage done) → rejected → returned
// (Chưa đạt, hoặc stage bị quay lại: vòng > 1 chưa xong) → pending.

export type PackStepStatus =
  | "pending"
  | "open"
  | "passed"
  | "skipped"
  | "returned"
  | "rejected"
  | "running"
  | "failed";

export type StepFacts = {
  /** cf-dify · stage tự chạy (`after.kind = auto`, bước Dify): đang chạy ⇒ `running`; lỗi hết lượt ⇒ `failed`. */
  auto?: boolean;
  /** `hub.stage_runs.status`. */
  stageStatus: string;
  /** `hub.stage_runs.round` (P-b2: +1 khi bị quay lại). */
  round: number;
  /** Task review gần nhất của stage (null khi chưa có). */
  task: { status: "open" | "closed"; result: string | null } | null;
};

export function stepStatusOf(f: StepFacts): PackStepStatus {
  if (f.stageStatus === "skipped") return "skipped";
  if (f.task?.status === "open") return "open";
  if (f.stageStatus === "done") return "passed";
  if (f.auto) {
    if (f.stageStatus === "running" || f.stageStatus === "queued") return "running";
    if (f.stageStatus === "needs_decision" || f.stageStatus === "failed") return "failed";
  }
  const result = f.task?.result ?? null;
  if (result === "reject") return "rejected";
  if (result === "fail" || f.round > 1) return "returned";
  return "pending";
}

type StageSnap = {
  key?: string;
  name?: string;
  after?: { kind?: string; group_id?: string | null } | null;
} | null;

/** Khoá/tên/Group duyệt của stage từ snapshot (snapshot hỏng ⇒ khoá `#i`). */
export function stageMeta(stage: StageSnap, idx: number) {
  const key = stage?.key ?? `#${idx + 1}`;
  const groupId = stage?.after?.kind === "review" ? (stage.after.group_id ?? null) : null;
  return { key, name: stage?.name ?? key, groupId };
}

/** Hạn hiển thị = mốc chuyển cấp của task (= `created_at + after_h`); vắng ⇒ null. */
export function dueOf(escalateAt: Date | string | null): string | null {
  if (escalateAt === null) return null;
  return (escalateAt instanceof Date ? escalateAt : new Date(escalateAt)).toISOString();
}
