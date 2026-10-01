// ADM-FR-11 · M2-R08 · "Model thấy gì": minh hoạ tool schema mà agent nhận được từ workflow (hàm thuần, không gọi server).
import type { ParamValues } from "./schemas";
import { parseOptions } from "./schemas";

type JsonType = "string" | "number" | "boolean";
type ToolParam = { type: JsonType; description: string; enum?: string[] };
export type ToolPreview = {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
  required: string[];
};

const JSON_TYPE: Record<ParamValues["type"], JsonType> = {
  text: "string",
  number: "number",
  boolean: "boolean",
  select: "string",
  file: "string",
};

/** `select` → `enum`; `file` → string. Tham số chưa có tên bị bỏ (đang soạn dở). */
export function toToolPreview(w: {
  key: string;
  description: string;
  input_schema: ParamValues[];
}): ToolPreview {
  const parameters: ToolPreview["parameters"] = {};
  const required: string[] = [];
  for (const p of w.input_schema) {
    if (p.name === "") continue;
    parameters[p.name] = {
      type: JSON_TYPE[p.type],
      description: p.description.trim(),
      ...(p.type === "select" ? { enum: parseOptions(p.options) } : {}),
    };
    if (p.required) required.push(p.name);
  }
  return { name: w.key, description: w.description.trim(), parameters, required };
}
