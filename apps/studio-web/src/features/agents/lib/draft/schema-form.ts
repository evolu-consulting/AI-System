// HUB-FR-61 · H4a-D9 · dựng form từ `agent_types.config_schema` (JSON Schema rút gọn): string, integer, number, boolean,
// enum, object 1 cấp; kiểu khác ⇒ ô JSON thô. Hàm thuần, không I/O. Giá trị lưu ở `draft.rawOptions`.
export type SKind = "string" | "integer" | "number" | "boolean" | "enum" | "object" | "json";
export type SField = {
  name: string;
  kind: SKind;
  required: boolean;
  options: string[];
  children: SField[];
  description?: string;
};
type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Schema => typeof v === "object" && v !== null && !Array.isArray(v);

function kindOf(s: Schema, depth: number): SKind {
  if (Array.isArray(s.enum) && s.enum.every((x) => typeof x === "string")) return "enum";
  switch (s.type) {
    case "string":
    case "integer":
    case "number":
    case "boolean":
      return s.type;
    case "object":
      return depth === 0 && isObj(s.properties) ? "object" : "json";
    default:
      return "json";
  }
}

function fieldsAt(schema: Schema, depth: number): SField[] {
  const props = isObj(schema.properties) ? schema.properties : {};
  const req = Array.isArray(schema.required) ? schema.required : [];
  return Object.entries(props).map(([name, raw]) => {
    const s = isObj(raw) ? raw : {};
    const kind = kindOf(s, depth);
    return {
      name,
      kind,
      required: req.includes(name),
      options: kind === "enum" ? (s.enum as string[]) : [],
      children: kind === "object" ? fieldsAt(s, depth + 1) : [],
      description: typeof s.description === "string" ? s.description : undefined,
    };
  });
}

/** Các trường cấp 1 của schema; rỗng ⇒ schema không khai `properties` (dùng ô JSON thô cho cả cấu hình). */
export const buildFields = (schema: Record<string, unknown>): SField[] => fieldsAt(schema, 0);

/** Ghi `value` tại `path` (bất biến); `undefined` ⇒ xoá khóa, object con rỗng bị bỏ. */
export function setAt(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path;
  if (head === undefined) return obj;
  const next = { ...obj };
  if (rest.length === 0) {
    if (value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const child = setAt(isObj(obj[head]) ? obj[head] : {}, rest, value);
  if (Object.keys(child).length === 0) delete next[head];
  else next[head] = child;
  return next;
}

export const getAt = (obj: Record<string, unknown>, path: string[]): unknown =>
  path.reduce<unknown>((o, k) => (isObj(o) ? o[k] : undefined), obj);

/** Chuỗi ô số → số; trống ⇒ undefined (xoá); không hợp lệ ⇒ null (giữ giá trị cũ). */
export function parseNum(text: string, integer: boolean): number | undefined | null {
  if (text.trim() === "") return undefined;
  const n = Number(text);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) return null;
  return n;
}

export type JsonParse = { ok: true; value: unknown } | { ok: false };
export function parseJson(text: string): JsonParse {
  if (text.trim() === "") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}
