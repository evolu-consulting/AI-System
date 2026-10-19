// HD-FR-31 · HD-FR-33 · HD-FR-37 · D3-01/D3-02/D3-12: def duyệt hợp đồng mà gói dựng cho tenant + luật rẽ cấp 2. Thuần (lớp 1).
// Ngưỡng KHÔNG nằm trong def: tool `contracts-value` so `total_value` hiện tại với ngưỡng của tenant và trả `level2` ("yes"/"no");
// def chỉ rẽ `level2 eq "no"` ⇒ bỏ bước cấp 2. Group duyệt lấy từ cài đặt tenant lúc dựng/đồng bộ def.

export const APPROVAL_PROCESS_KEY = "contracts-approval";
/** Khoá stage duyệt cấp 2 trong def (finalize kiểm có Đạt ở stage này khi giá trị cần cấp 2). */
export const APPROVE_STAGE = "approve";
/** Khoá stage cấp 1 (review của stage trích) — sửa `total_value` ở đây vẫn được (D3-02). */
export const LEVEL1_STAGE = "extract";
export const CONTRACT_TOOL_KEYS = {
  extract: "contracts-extract",
  value: "contracts-value",
  finalize: "contracts-finalize",
} as const;

/** Mặc định khi tenant chưa lưu cài đặt — nguồn: spec HD3 §5 (ngưỡng: intake-hd câu 3; Group: tự quyết D3-12). */
export const APPROVAL_DEFAULTS = {
  threshold: 500_000_000,
  level1GroupKey: "contracts-editor",
  level2GroupKey: "contracts-owner",
} as const;
export type ApprovalSettings = {
  threshold: number;
  level1GroupKey: string;
  level2GroupKey: string;
};
export const APPROVAL_THRESHOLD_MAX = 1_000_000_000_000_000;

/** `total_value ≥ ngưỡng` ⇒ cấp 2; trống / không phải số hữu hạn / âm ⇒ cấp 2 (an toàn, intake câu 1). */
export function needsLevel2(total: unknown, threshold: number): boolean {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return true;
  return total >= threshold;
}

export type ApprovalStep =
  | "extract"
  | "level1"
  | "value"
  | "level2"
  | "finalize"
  | "done"
  | "rejected"
  | "cancelled";

const STAGE_STEP: Record<string, ApprovalStep> = {
  extract: "extract",
  value: "value",
  approve: "level2",
  finalize: "finalize",
};

/** Trạng thái run + stage hiện tại ⇒ bước hiển thị (HD-FR-36). */
export function approvalStepOf(
  status: string,
  stageKey: string | null,
  rejected: boolean,
): ApprovalStep {
  if (status === "done") return "done";
  if (status === "cancelled" || status === "failed" || status === "expired")
    return rejected ? "rejected" : "cancelled";
  if (stageKey === "extract") return status === "waiting_review" ? "level1" : "extract";
  return STAGE_STEP[stageKey ?? ""] ?? "extract";
}

const ARGS = { contract_id: { from: "input", key: "contract-id" } } as const;

function toolStage(o: {
  key: string;
  name: string;
  step: number;
  tool: string;
  fields: { key: string; type: "number" | "string"; required: boolean }[];
  after: { kind: string } & Record<string, unknown>;
  timeoutS: number;
}) {
  return {
    key: o.key,
    name: o.name,
    step: o.step,
    executor: { kind: "tool", tool_key: o.tool, args: ARGS },
    instruction: "",
    output: { filename: `${o.key}.md`, template: "x", required_sections: ["x"], fields: o.fields },
    after: o.after,
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: o.timeoutS,
    token_budget: null,
  };
}

const review = (groupId: string, excludeStarter: boolean) => ({
  kind: "review",
  group_id: groupId,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: excludeStarter,
});

/** Def `contracts-approval` (= body `POST /process-defs`): trích (cấp 1) → giá trị (rẽ) → cấp 2 → ghi "Đã duyệt". */
export function buildApprovalDef(g: { level1GroupId: string; level2GroupId: string }) {
  const level2 = { key: "level2", type: "string" as const, required: true };
  const total = { key: "total_value", type: "number" as const, required: false };
  return {
    key: APPROVAL_PROCESS_KEY,
    name: "Duyệt hợp đồng",
    description:
      "AI đọc hợp đồng → người phụ trách kiểm → (giá trị ≥ ngưỡng) cấp 2 duyệt → Đã duyệt.",
    input_hint: "Mã hợp đồng",
    run_group_ids: [g.level1GroupId, g.level2GroupId],
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: [{ key: "contract-id", label: "Hợp đồng", type: "text" as const, required: true }],
    stages: [
      toolStage({
        key: "extract",
        name: "AI đọc hợp đồng",
        step: 0,
        tool: CONTRACT_TOOL_KEYS.extract,
        fields: [total],
        after: review(g.level1GroupId, false),
        timeoutS: 900,
      }),
      toolStage({
        key: "value",
        name: "Kiểm giá trị",
        step: 1,
        tool: CONTRACT_TOOL_KEYS.value,
        fields: [total, level2],
        after: { kind: "auto", branch: [{ field: "level2", op: "eq", value: "no", goto_step: 3 }] },
        timeoutS: 60,
      }),
      toolStage({
        key: "approve",
        name: "Duyệt cấp 2",
        step: 2,
        tool: CONTRACT_TOOL_KEYS.value,
        fields: [total, level2],
        after: review(g.level2GroupId, true),
        timeoutS: 60,
      }),
      toolStage({
        key: "finalize",
        name: "Ghi Đã duyệt",
        step: 3,
        tool: CONTRACT_TOOL_KEYS.finalize,
        fields: [],
        after: { kind: "auto", branch: [] },
        timeoutS: 60,
      }),
    ],
  };
}
