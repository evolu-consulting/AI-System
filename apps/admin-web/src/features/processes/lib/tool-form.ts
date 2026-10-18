// ADM-FR-71 · HUB-FR-146 · AC-H44 · P-d2 (plan-frontend-d2 §10; plan-addendum A3): stage "Gọi tool" của editor — ép giá trị khoá,
// đổi qua lại với contract. Hàm thuần theo mẫu `wait-form` (không React, không gọi API).
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { type ParamShape, tooManyParams } from "../domain/tool-rules";
import { emptyAutofix } from "./autofix-form";
import type { ArgDraft, StageDraft, ToolDraft } from "./draft-types";

type ToolExecutor = Extract<ProcessStageDef["executor"], { kind: "tool" }>;
type ToolArgs = ToolExecutor["args"];

/** Giá trị `StageDraft.executor` của kiểu "Gọi tool". */
export const TOOL_EXECUTOR = "tool";
export const TOOL_SECTIONS = ["Kết quả", "Bàn giao"] as const;

export const emptyTool = (): ToolDraft => ({ key: "", args: {} });
export const emptyArg = (): ArgDraft => ({ from: "", value: "", kind: "string" });
export const isTool = (s: Pick<StageDraft, "executor">): boolean => s.executor === TOOL_EXECUTOR;

/** Chọn "Gọi tool": chỉ đổi executor (`after` và `real` giữ — tool có tác dụng phụ thì bật `real` ở bước chọn tool). */
export const TOOL_PATCH: Partial<StageDraft> = { executor: TOOL_EXECUTOR };

/** Bản dùng để gửi/validate: ép các ô Hub ép (A3), giữ `fields`, `filename`, `timeout`. */
export function normalizeTool(s: StageDraft): StageDraft {
  if (!isTool(s)) return s;
  return {
    ...s,
    instruction: "",
    template: `# ${s.name.trim()}\n\n## ${TOOL_SECTIONS[0]}\n\n## ${TOOL_SECTIONS[1]}\n`,
    sections: [...TOOL_SECTIONS],
    answerer: "starter",
    answererId: "",
    budget: "",
    sources: [],
    mustKnow: "",
    autofix: emptyAutofix(),
  };
}

/** Ghi lại một nguồn tham số từ contract thành bản nháp. */
function argFromDef(a: ToolArgs[string]): ArgDraft {
  if (a.from === "input") return { from: "input", value: a.key, kind: "string" };
  if (a.from === "field")
    return { from: "field", value: `${a.stage_key}:${a.field}`, kind: "string" };
  const kind =
    typeof a.value === "number" ? "number" : typeof a.value === "boolean" ? "boolean" : "string";
  return { from: "const", value: String(a.value), kind };
}

export function toolFromDef(ex: ToolExecutor): ToolDraft {
  return {
    key: ex.tool_key,
    args: Object.fromEntries(Object.entries(ex.args).map(([n, a]) => [n, argFromDef(a)])),
  };
}

/** Một nguồn nháp → contract; chưa chọn / thiếu giá trị / số không hợp lệ ⇒ null (tham số bị bỏ, lỗi thiếu hiện live). */
function argToDef(a: ArgDraft): ToolArgs[string] | null {
  if (a.from === "" || a.value === "") return null;
  if (a.from === "input") return { from: "input", key: a.value };
  if (a.from === "field") {
    const [stage_key = "", field = ""] = a.value.split(":");
    return { from: "field", stage_key, field };
  }
  if (a.kind === "boolean") return { from: "const", value: a.value === "true" };
  if (a.kind === "number") {
    const n = Number(a.value);
    return Number.isFinite(n) ? { from: "const", value: n } : null;
  }
  return { from: "const", value: a.value };
}

export function toolToDef(t: ToolDraft): ToolExecutor {
  const args: ToolArgs = {};
  for (const [name, a] of Object.entries(t.args)) {
    const d = argToDef(a);
    if (d) args[name] = d;
  }
  return { kind: "tool", tool_key: t.key, args };
}

/** Đã khai nguồn đủ để gửi cho tham số `name`? */
export const hasArg = (t: ToolDraft, name: string): boolean => {
  const a = t.args[name];
  return a !== undefined && argToDef(a) !== null;
};

/** Đặt (một phần) nguồn của tham số `name`. */
export function setArg(t: ToolDraft, name: string, patch: Partial<ArgDraft>): ToolDraft {
  return { ...t, args: { ...t.args, [name]: { ...(t.args[name] ?? emptyArg()), ...patch } } };
}

/**
 * Đổi tool (D2-35): giữ nguồn của tham số trùng TÊN + KIỂU ở tool mới; còn lại bỏ. Tool mới chưa biết tham số
 * (catalog chưa nạp) ⇒ bỏ hết.
 */
export function switchTool(
  t: ToolDraft,
  key: string,
  prev: readonly ParamShape[],
  next: readonly ParamShape[],
): ToolDraft {
  const args: Record<string, ArgDraft> = {};
  for (const p of next) {
    const old = prev.find((x) => x.name === p.name && x.type === p.type);
    const a = t.args[p.name];
    if (old && a) args[p.name] = a;
  }
  return { key, args };
}

/** Tool dùng được trong quy trình? (không có tham số tệp, ≤ 20 tham số). */
export const toolUsable = (tool: { params: readonly ParamShape[] }): boolean =>
  !tool.params.some((p) => p.type === "file") && !tooManyParams(tool);

/** Khoá câu lỗi tool theo path server (`stages.i.executor`, `.executor.args.<name>`, `.executor.tool_key`). */
export function toolErrorAt(
  errors: Record<string, string>,
  i: number,
  name?: string,
): string | undefined {
  const base = `stages.${i}.executor`;
  return name === undefined ? errors[base] : errors[`${base}.args.${name}`];
}
