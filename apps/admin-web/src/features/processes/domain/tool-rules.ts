// HUB-FR-146 · AC-H44 · P-d2 (plan-frontend-d2 §10; plan-d2-rules §2, D2-29): luật thuần của khối "Gọi tool" — tương thích kiểu
// nguồn ↔ kiểu tham số (CÙNG ma trận contract/BE), liệt kê nguồn chọn được, tham số thiếu. Thuần, built-in (ADR-0023).

export type SourceType = "string" | "number" | "date" | "boolean";
export type ParamShape = {
  name: string;
  type: string;
  required: boolean;
  options?: readonly string[];
};
export type ToolShape = { key: string; side_effect: boolean; params: readonly ParamShape[] };

/** Trần số tham số khai báo (= contract `TOOL_ARGS_MAX`). */
export const TOOL_ARGS_LIMIT = 20;

/** D2-29 · nguồn kiểu `src` đưa được vào tham số kiểu `paramType` không. */
export function paramCompatible(src: SourceType, paramType: string): boolean {
  if (paramType === "number") return src === "number";
  if (paramType === "boolean") return src === "boolean";
  if (paramType === "select") return src === "string";
  if (paramType === "text" || paramType === "paragraph") return true;
  return src === paramType || src === "string";
}

export const isFileParam = (p: Pick<ParamShape, "type">): boolean => p.type === "file";
export const hasFileParam = (t: Pick<ToolShape, "params">): boolean => t.params.some(isFileParam);

/** Kiểu nguồn của input quy trình; `file` (và kiểu lạ) không làm nguồn ⇒ null. */
export function inputSourceType(t: string): SourceType | null {
  if (t === "text" || t === "select" || t === "source_ref") return "string";
  return t === "date" || t === "number" ? t : null;
}

/** Kiểu nguồn của trường output (`FieldDraft.type`). */
export const fieldSourceType = (t: string): SourceType | null =>
  t === "string" || t === "number" || t === "date" ? t : null;

export type InputLite = { key: string; label: string; type: string };
export type StageLite = {
  key: string;
  name: string;
  step: number;
  fields: readonly { key: string; type: string }[];
};
export type ArgSourceOption =
  | { kind: "input"; value: string; key: string; label: string }
  | { kind: "field"; value: string; stageKey: string; n: number; field: string };

/** Input quy trình đưa được vào tham số kiểu `paramType`. */
export function inputOptions(inputs: readonly InputLite[], paramType: string): ArgSourceOption[] {
  return inputs.flatMap((i) => {
    const st = inputSourceType(i.type);
    return st && paramCompatible(st, paramType)
      ? [{ kind: "input" as const, value: i.key, key: i.key, label: i.label }]
      : [];
  });
}

/** Trường output của giai đoạn ở bước NHỎ HƠN `step` đưa được vào tham số kiểu `paramType`; `n` = chỉ số giai đoạn + 1. */
export function fieldOptions(
  stages: readonly StageLite[],
  step: number,
  paramType: string,
): ArgSourceOption[] {
  return stages.flatMap((s, idx) =>
    s.step >= step
      ? []
      : s.fields.flatMap((f) => {
          const st = fieldSourceType(f.type);
          return st && paramCompatible(st, paramType)
            ? [
                {
                  kind: "field" as const,
                  value: `${s.key}:${f.key}`,
                  stageKey: s.key,
                  n: idx + 1,
                  field: f.key,
                },
              ]
            : [];
        }),
  );
}

/** Tên tham số bắt buộc chưa khai nguồn (`has(name)` = đã chọn nguồn + có giá trị). */
export function missingRequiredArgs(
  tool: Pick<ToolShape, "params">,
  has: (name: string) => boolean,
): string[] {
  return tool.params.filter((p) => p.required && !has(p.name)).map((p) => p.name);
}

/** Số tham số khai báo vượt trần ⇒ tool không dùng được (lỗi hiện ở `executor`). */
export const tooManyParams = (tool: Pick<ToolShape, "params">): boolean =>
  tool.params.length > TOOL_ARGS_LIMIT;
