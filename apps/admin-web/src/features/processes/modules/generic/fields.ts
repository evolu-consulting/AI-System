// CR-125 · m6a · MOD-FR-07: schema cổng cấu hình (`configPort`) → danh sách ô nhập của panel chung. Thuần (không React), test bằng unit.
// Nhãn nghiệp vụ lấy từ `.describe()` của trường zod (khai ở decl); không có ⇒ tên trường đọc được (không lộ dấu gạch dưới).
import type { PortSchema, PortWidget } from "@ai/contracts/modules";

export type FieldKind =
  | "person"
  | "people"
  | "department"
  | "number"
  | "bool"
  | "enum"
  | "text"
  | "longtext"
  | "date"
  | "attachments";

export type PanelField = {
  key: string;
  kind: FieldKind;
  label: string;
  required: boolean;
  /** `enum` ⇒ các giá trị cho phép. */
  options?: readonly string[];
  /** Số nguyên (ngày, giờ). */
  integer?: boolean;
};

type Def = {
  type?: string;
  innerType?: unknown;
  shape?: Record<string, unknown>;
  entries?: Record<string, string>;
};
type Zod = { _zod?: { def?: Def }; def?: Def; description?: string };

const defOf = (s: unknown): Def => (s as Zod)._zod?.def ?? (s as Zod).def ?? {};

/** Gỡ lớp optional/nullable/default/readonly; trả lõi và cờ "bắt buộc". */
function unwrap(s: unknown): { core: unknown; required: boolean; description?: string } {
  let cur = s;
  let required = true;
  let description = (s as Zod).description;
  for (;;) {
    const d = defOf(cur);
    if (d.type === "optional" || d.type === "nullable" || d.type === "default") {
      required = false;
      cur = d.innerType;
    } else if (d.type === "readonly" || d.type === "prefault") {
      cur = d.innerType;
    } else break;
    description ??= (cur as Zod).description;
  }
  return description === undefined ? { core: cur, required } : { core: cur, required, description };
}

/** `attachments` (tệp đính kèm — CR-125 phiếu yêu cầu) nằm ngoài `PortWidget` của m1: khai thêm ở đây cho panel chung. */
const WIDGET_KIND: Record<PortWidget | "attachments", FieldKind> = {
  attachments: "attachments",
  person: "person",
  people: "people",
  department: "department",
  days: "number",
  hours: "number",
  money: "number",
  text: "text",
  longtext: "longtext",
  enum: "enum",
  date: "date",
};

const KIND_OF_TYPE: Record<string, FieldKind | undefined> = {
  boolean: "bool",
  number: "number",
  int: "number",
  enum: "enum",
  string: "text",
};

/** `due_days` → "Due days" chỉ khi decl chưa đặt nhãn; có `.describe()` thì dùng nhãn đó. */
export function readableKey(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Trường của cổng cấu hình; bỏ đầu vào của flow (`contract_id` — tự nối, không phải ô cấu hình của node). */
const configEntries = (shape: Record<string, unknown>): [string, unknown][] =>
  Object.entries(shape).filter(([k]) => k !== "contract_id");

export function fieldsOf(port: PortSchema): PanelField[] {
  const root = unwrap(port.schema).core;
  const shape = defOf(root).shape;
  if (!shape) return [];
  const out: PanelField[] = [];
  for (const [key, raw] of configEntries(shape)) {
    const { core, required, description } = unwrap(raw);
    const d = defOf(core);
    const w = port.widgets?.[key] as PortWidget | "attachments" | undefined;
    const kind = w ? WIDGET_KIND[w] : KIND_OF_TYPE[d.type ?? ""];
    if (!kind) continue; // kiểu chưa hỗ trợ (object lồng…) ⇒ để panel riêng
    const f: PanelField = { key, kind, label: description ?? readableKey(key), required };
    if (kind === "enum" && d.entries) f.options = Object.values(d.entries);
    if (kind === "number")
      f.integer = (core as { isInt?: boolean }).isInt === true || w === "days" || w === "hours";
    out.push(f);
  }
  return out;
}

/** Giá trị args (đơn) ⇄ giá trị ô nhập. Bool/number giữ kiểu; trống ⇒ bỏ khoá. */
export function toArg(f: PanelField, raw: string): string | number | boolean | undefined {
  if (raw.trim() === "") return undefined;
  if (f.kind === "bool") return raw === "true";
  if (f.kind === "number") {
    const n = Number(raw);
    if (Number.isNaN(n)) return undefined;
    return f.integer ? Math.trunc(n) : n;
  }
  return raw;
}
