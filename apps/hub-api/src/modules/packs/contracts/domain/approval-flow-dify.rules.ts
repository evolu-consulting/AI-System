// cf-dify · luật thuần bước Dify của luồng duyệt: ánh xạ dữ liệu HĐ ⇒ tham số workflow, kiểm catalog, input run. Lớp 1.

import type { ApprovalFlowIssue, DifyWorkflow, FlowStep } from "./approval-flow.types";

const validValue = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Dữ liệu HĐ truyền cho workflow Dify: tên tham số workflow ⇒ input của run engine (`openRun` điền). Tham số bắt buộc khác
 * ⇒ không thoả được ⇒ PUT 422 `DIFY_PARAM_UNSUPPORTED`; tham số tuỳ chọn lạ bị bỏ (không truyền).
 */
export const DIFY_CONTRACT_INPUTS = {
  contract_id: { key: "contract-id", type: "text", label: "Hợp đồng" },
  title: { key: "contract-title", type: "text", label: "Tiêu đề hợp đồng" },
  deal: { key: "contract-deal", type: "text", label: "Loại hợp đồng" },
  total_value: { key: "contract-value", type: "number", label: "Giá trị hợp đồng" },
  partner: { key: "contract-partner", type: "text", label: "Đối tác" },
} as const;
export type DifyParamName = keyof typeof DIFY_CONTRACT_INPUTS;
const TEXT_PARAM_TYPES: ReadonlySet<string> = new Set(["text", "paragraph"]);
const VALUE_PARAM_TYPES: ReadonlySet<string> = new Set(["number", "text", "paragraph"]);

const paramFits = (name: string, type: string): name is DifyParamName =>
  name in DIFY_CONTRACT_INPUTS &&
  (name === "total_value" ? VALUE_PARAM_TYPES : TEXT_PARAM_TYPES).has(type);

/** Tham số workflow thoả được từ dữ liệu HĐ; `ok=false` khi có tham số bắt buộc không thoả. */
export function difyArgsOf(wf: DifyWorkflow): { ok: boolean; names: DifyParamName[] } {
  const names: DifyParamName[] = [];
  let ok = true;
  for (const p of wf.params) {
    if (paramFits(p.name, p.type)) names.push(p.name);
    else if (p.required) ok = false;
  }
  return { ok, names };
}

/** Bước Dify phải trỏ workflow có trong catalog của tenant và thoả được tham số bắt buộc. */
export function validateDifyCatalog(
  steps: readonly FlowStep[],
  catalog: readonly DifyWorkflow[],
): ApprovalFlowIssue[] {
  const by = new Map(catalog.map((w) => [w.key, w]));
  const out: ApprovalFlowIssue[] = [];
  steps.forEach((s, i) => {
    if (s.kind !== "dify") return;
    const wf = by.get(s.workflow_key);
    const path = `steps.${i}.workflow_key`;
    if (!wf) out.push({ path, rule: "DIFY_WORKFLOW_UNKNOWN" });
    else if (!difyArgsOf(wf).ok) out.push({ path, rule: "DIFY_PARAM_UNSUPPORTED" });
  });
  return out;
}

const DIFY_TEXT_MAX = 2000;
/** Input run điền cho bước Dify: văn bản cắt trần; giá trị không hợp lệ/trống ⇒ "0" (input number luôn có). */
export function difyRunInputs(f: {
  title: string;
  deal: string | null;
  totalValue: unknown;
  partner: string;
}): (
  | { type: "text"; key: string; text: string }
  | { type: "number"; key: string; value: string }
)[] {
  const text = (k: DifyParamName, s: string) => ({
    type: "text" as const,
    key: DIFY_CONTRACT_INPUTS[k].key,
    text: s.slice(0, DIFY_TEXT_MAX),
  });
  return [
    text("title", f.title),
    text("deal", f.deal ?? ""),
    text("partner", f.partner),
    {
      type: "number",
      key: DIFY_CONTRACT_INPUTS.total_value.key,
      value: validValue(f.totalValue) ? String(f.totalValue) : "0",
    },
  ];
}

export const hasDifyStep = (steps: readonly FlowStep[]): boolean =>
  steps.some((s) => s.kind === "dify");
