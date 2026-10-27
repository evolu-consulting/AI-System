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

const isField = (f: unknown): f is DifyParamName =>
  typeof f === "string" && Object.hasOwn(DIFY_CONTRACT_INPUTS, f);

/** Trường HĐ `field` đưa được vào tham số kiểu `type` (số chỉ nhận giá trị HĐ; còn lại nhận văn bản). */
const fieldFits = (field: DifyParamName, type: string): boolean =>
  (field === "total_value" ? VALUE_PARAM_TYPES : TEXT_PARAM_TYPES).has(type);

type FlowInputs = Readonly<Record<string, string>> | undefined;

/** Trường HĐ của tham số: ánh xạ tường minh (explicit), không thì cùng tên trường HĐ; giá trị ánh xạ lạ ⇒ null. */
function fieldOf(
  name: string,
  inputs: FlowInputs,
): { field: DifyParamName | null; explicit: boolean } {
  const explicit = inputs !== undefined && Object.hasOwn(inputs, name);
  const v = explicit ? inputs[name] : name;
  return { field: isField(v) ? v : null, explicit };
}

/**
 * dify-input-map · ánh xạ hiệu lực tham số ⇒ trường HĐ: `inputs` do người sửa luồng chọn; tham số không ánh xạ mà trùng tên
 * trường HĐ ⇒ khớp cùng tên (như cũ). `ok=false` khi có tham số bắt buộc không thoả; `unknown` = khoá `inputs` không có trong
 * workflow (hoặc giá trị không phải trường HĐ); `misfit` = ánh xạ sai kiểu.
 */
export function difyArgsOf(
  wf: DifyWorkflow,
  inputs?: FlowInputs,
): {
  ok: boolean;
  pairs: [string, DifyParamName][];
  unknown: string[];
  misfit: string[];
} {
  const pairs: [string, DifyParamName][] = [];
  const misfit: string[] = [];
  let ok = true;
  const names = new Set(wf.params.map((p) => p.name));
  const unknown = Object.entries(inputs ?? {})
    .filter(([k, v]) => !names.has(k) || !isField(v))
    .map(([k]) => k);
  for (const p of wf.params) {
    const r = fieldOf(p.name, inputs);
    if (r.field && fieldFits(r.field, p.type)) pairs.push([p.name, r.field]);
    else {
      if (r.field && r.explicit) misfit.push(p.name);
      if (p.required) ok = false;
    }
  }
  return { ok, pairs, unknown, misfit };
}

/** Bước Dify phải trỏ workflow có trong catalog của tenant, ánh xạ hợp lệ và thoả được tham số bắt buộc. */
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
    if (!wf) {
      out.push({ path, rule: "DIFY_WORKFLOW_UNKNOWN" });
      return;
    }
    const a = difyArgsOf(wf, s.inputs);
    for (const k of a.unknown)
      out.push({ path: `steps.${i}.inputs.${k}`, rule: "DIFY_INPUT_UNKNOWN" });
    for (const k of a.misfit)
      out.push({ path: `steps.${i}.inputs.${k}`, rule: "DIFY_PARAM_UNSUPPORTED" });
    if (!a.ok && a.misfit.length === 0) out.push({ path, rule: "DIFY_PARAM_UNSUPPORTED" });
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
