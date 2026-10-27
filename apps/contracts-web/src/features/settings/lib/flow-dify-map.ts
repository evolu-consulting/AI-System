// dify-input-map · ánh xạ tham số workflow Dify ⇒ trường hợp đồng (logic thuần của UI bước Dify).
import { FLOW_CONTRACT_FIELDS, type FlowContractField } from "@ai/contracts";
import type { DifyWorkflowItem, FlowStep } from "../api-flow";
import type { FlowIssue } from "./flow-state";

export type DifyInputDef = DifyWorkflowItem["inputs"][number];
export type DifyMap = Record<string, FlowContractField>;

export const CONTRACT_FIELDS = FLOW_CONTRACT_FIELDS;

/** Tên gợi ý (chỉ là mặc định của UI; người dùng đổi được, lưu tường minh). */
const ALIASES: Record<FlowContractField, readonly string[]> = {
  total_value: ["value", "amount", "gia_tri", "contract_value", "total"],
  deal: ["type", "loai", "deal", "contract_type", "kind"],
  partner: ["partner", "doi_tac", "customer", "partner_name"],
  title: ["name", "title", "ten", "contract_name", "contract_title"],
  contract_id: ["id", "contract_id", "ma", "ma_hop_dong"],
};

/** Trường HĐ nhận được vào tham số kiểu `type`: số chỉ nhận giá trị HĐ; văn bản nhận mọi trường; kiểu khác không nhận. */
export function fieldsFor(type: string): readonly FlowContractField[] {
  if (type === "number") return ["total_value"];
  return type === "text" || type === "paragraph" ? CONTRACT_FIELDS : [];
}

/** Gợi ý trường cho một tham số: trùng tên trường HĐ, rồi tới bí danh; không phù hợp kiểu ⇒ undefined. */
export function guessField(p: Pick<DifyInputDef, "name" | "type">): FlowContractField | undefined {
  const n = p.name.toLowerCase();
  const ok = fieldsFor(p.type);
  const exact = ok.find((f) => f === n);
  if (exact) return exact;
  return ok.find((f) => ALIASES[f].includes(n));
}

/** Ánh xạ mặc định khi thêm bước: mọi tham số có gợi ý. */
export function defaultMapping(inputs: readonly DifyInputDef[]): DifyMap {
  const out: DifyMap = {};
  for (const p of inputs) {
    const g = guessField(p);
    if (g) out[p.name] = g;
  }
  return out;
}

/** Trường đang hiệu lực của tham số (đúng như server: ánh xạ tường minh, không thì cùng tên trường HĐ). */
export function effectiveField(
  step: { inputs?: DifyMap | undefined },
  p: Pick<DifyInputDef, "name" | "type">,
): FlowContractField | undefined {
  const m = step.inputs?.[p.name];
  if (m) return m;
  const same = FLOW_CONTRACT_FIELDS.find((f) => f === p.name);
  return same && fieldsFor(p.type).includes(same) ? same : undefined;
}

/** Đặt/bỏ một ánh xạ; bỏ hết ⇒ `undefined` (không gửi khoá `inputs`). */
export function setMapping(
  cur: DifyMap | undefined,
  name: string,
  field: FlowContractField | "",
): DifyMap | undefined {
  const next: DifyMap = { ...cur };
  if (field) next[name] = field;
  else delete next[name];
  return Object.keys(next).length ? next : undefined;
}

/** Tham số bắt buộc chưa ánh xạ được ⇒ lỗi tại `inputs.<tên>` (cùng mã luật server `DIFY_PARAM_UNSUPPORTED`). */
export function difyInputIssues(
  steps: readonly FlowStep[],
  catalog: readonly DifyWorkflowItem[] | undefined,
): FlowIssue[] {
  if (!catalog) return [];
  const out: FlowIssue[] = [];
  steps.forEach((s, index) => {
    if (s.kind !== "dify") return;
    const wf = catalog.find((w) => w.key === s.workflow_key);
    for (const p of wf?.inputs ?? [])
      if (p.required && !effectiveField(s, p))
        out.push({ index, field: `inputs.${p.name}`, code: "DIFY_PARAM_UNSUPPORTED" });
  });
  return out;
}
