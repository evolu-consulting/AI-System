// CR-118 · cr118-routing-diagram · `slot_body` của quy trình đã gán (GET .../process-routing/:slot/processes/:defId) ⇒ bước cho
// canvas chỉ đọc (`CurrentStep`). Cùng hình `slot_body` với admin-web (`{steps:[…]}` hoặc mảng trần; phòng ban theo MÃ nhóm).
import type { FlowWhen } from "@ai/contracts";
import type { CurrentStep } from "./current-flow";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

function stepOf(s: Record<string, unknown>, i: number): CurrentStep | null {
  const kind = s.kind;
  if (kind !== "review" && kind !== "esign" && kind !== "dify") return null;
  const signer = isObj(s.company_signer) ? str(s.company_signer.mode) : null;
  const dept =
    kind === "review"
      ? str(s.department_group_key)
      : kind === "esign"
        ? signer
        : str(s.workflow_key);
  return {
    key: str(s.key) ?? `s${i}`,
    name: str(s.name) ?? `#${i + 1}`,
    department: dept,
    kind,
    when: kind === "review" && isObj(s.when) ? (s.when as FlowWhen) : null,
    dueH: num(s.due_h),
    remindH: num(s.remind_every_h),
    escalateGroup: str(s.escalate_group_key),
    approverCount: null,
  };
}

/** `slot_body` ⇒ bước; không phải dạng bước tuần tự / rỗng ⇒ null (UI báo "không xem được"). */
export function stepsFromSlotBody(body: unknown): CurrentStep[] | null {
  const list = Array.isArray(body)
    ? body
    : isObj(body) && Array.isArray(body.steps)
      ? body.steps
      : null;
  if (!list || list.length === 0) return null;
  const out: CurrentStep[] = [];
  for (const [i, s] of list.entries()) {
    const step = isObj(s) ? stepOf(s, i) : null;
    if (!step) return null;
    out.push(step);
  }
  return out;
}

export type DefDiagram =
  | { state: "idle" | "loading" }
  | { state: "unavailable" }
  | { state: "ready"; steps: CurrentStep[] };

/** Trạng thái hiển thị từ kết quả truy vấn: lỗi (404 ngoài tập…) hoặc thân không đọc được ⇒ "unavailable". */
export function defDiagramState(q: {
  enabled: boolean;
  isError: boolean;
  data: { slot_body?: unknown } | undefined;
}): DefDiagram {
  if (q.isError) return { state: "unavailable" };
  if (!q.data) return { state: q.enabled ? "loading" : "idle" };
  const steps = stepsFromSlotBody(q.data.slot_body);
  return steps ? { state: "ready", steps } : { state: "unavailable" };
}
