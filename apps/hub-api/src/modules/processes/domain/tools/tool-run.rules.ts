// HUB-FR-146 · AC-H44 · PD2-R03 · plan-d2-rules §1, D2-29: dựng tham số gọi tool từ nguồn (input start / trường output
// stage trước / hằng). Thuần, lớp 1 (không import contract).

/** Nguồn một tham số (camelCase domain; mapper đổi từ `stage_key` của contract). */
export type ArgSource =
  | { from: "input"; key: string }
  | { from: "field"; stageKey: string; field: string }
  | { from: "const"; value: string | number | boolean };

export type ToolArgValue = string | number | boolean;
export type BuiltArgs =
  | { ok: true; values: Record<string, ToolArgValue> }
  | { ok: false; missing: string };

/** Giá trị của một nguồn; vắng (input không có, stage nguồn `skipped` = null, trường không có) ⇒ `undefined`. */
function sourceValue(
  src: ArgSource,
  inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>,
  inputTypes: ReadonlyMap<string, string> | undefined,
): ToolArgValue | undefined {
  if (src.from === "const") return src.value;
  if (src.from === "input") {
    const v = inputs.get(src.key);
    if (v === undefined) return undefined;
    return inputTypes?.get(src.key) === "number" ? Number(v) : v;
  }
  const f = fields.get(src.stageKey);
  return f ? f[src.field] : undefined;
}

/**
 * PD2-U04/U05 · mọi tham số theo thứ tự khai; nguồn đầu tiên vắng ⇒ `{ok:false, missing:<tên tham số>}`. `inputTypes`
 * (D2-29): input kiểu `number` ⇒ `Number(value)`; không truyền ⇒ giữ chuỗi.
 */
export function buildToolArgs(
  args: Readonly<Record<string, ArgSource>>,
  inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>,
  inputTypes?: ReadonlyMap<string, string>,
): BuiltArgs {
  const values: Record<string, ToolArgValue> = {};
  for (const [name, src] of Object.entries(args)) {
    const v = sourceValue(src, inputs, fields, inputTypes);
    if (v === undefined) return { ok: false, missing: name };
    values[name] = v;
  }
  return { ok: true, values };
}
