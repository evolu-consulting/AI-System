// HUB-FR-106 · P-R03 · M3 · PF1 · kiểm template output stage (plan §3.2, plan-contract §7 `checkTemplate`).
// Thuần: mục = heading cấp **2** (`## <tên>`, không `###`), so không phân biệt hoa thường + trim, thân không rỗng;
// trường = khối ```fields {json}``` (chỉ khi template khai báo fields). Không log nội dung.

/** Trường khai báo trong `ProcessStageDef.output.fields` (plan-contract §6). */
export type FieldDef = { key: string; type: "number" | "string" | "date"; required: boolean };

export type TemplateCheck = {
  ok: boolean;
  missing: string[];
  fields: Record<string, string | number> | null;
  fieldErrors: string[];
};

/** Heading cấp đúng 2 (`##` theo sau không phải `#`). */
const HEADING = /^##(?!#)\s*(.+?)\s*$/;
const FIELDS_FENCE = /```fields\s*\r?\n([\s\S]*?)\r?\n```/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const norm = (s: string): string => s.trim().toLowerCase();

/** Các mục `## <tên>` theo thứ tự xuất hiện, thân đã trim (bỏ khối ```fields```). */
function sections(md: string): { name: string; body: string }[] {
  const out: { name: string; body: string }[] = [];
  let cur: { name: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ name: cur.name, body: cur.lines.join("\n").trim() });
  };
  for (const line of md.split(/\r?\n/)) {
    const m = HEADING.exec(line);
    if (m) {
      flush();
      cur = { name: m[1] ?? "", lines: [] };
    } else if (cur) {
      cur.lines.push(line);
    }
  }
  flush();
  return out;
}

/** Map mục chuẩn hoá → thân (mục cuối thắng nếu trùng). */
function sectionMap(md: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of sections(md)) map.set(norm(s.name), s.body);
  return map;
}

/** Giá trị hợp kiểu `def` hay không (undefined/null ⇒ thiếu). */
function fieldOk(def: FieldDef, v: unknown): boolean {
  if (def.type === "number") return typeof v === "number" && Number.isFinite(v);
  if (def.type === "date") return typeof v === "string" && DATE_RE.test(v);
  return typeof v === "string";
}

/** Khối ```fields``` → object, hoặc null khi JSON hỏng / không phải object. */
function parseFieldsJson(md: string): Record<string, unknown> | null {
  const m = FIELDS_FENCE.exec(md);
  if (!m) return null;
  try {
    const v = JSON.parse(m[1] ?? "");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Trích + kiểm khối ```fields``` theo khai báo; trả `{fields, fieldErrors}`. */
function parseFields(
  md: string,
  defs: readonly FieldDef[],
): {
  fields: Record<string, string | number> | null;
  fieldErrors: string[];
} {
  const hasFence = FIELDS_FENCE.test(md);
  const obj = parseFieldsJson(md);
  if (hasFence && obj === null) return { fields: null, fieldErrors: ["fields_json_invalid"] };
  const fieldErrors: string[] = [];
  const fields: Record<string, string | number> = {};
  for (const f of defs) {
    const v = obj?.[f.key];
    if (v === undefined || v === null) {
      if (f.required) fieldErrors.push(f.key);
    } else if (fieldOk(f, v)) {
      fields[f.key] = v as string | number;
    } else {
      fieldErrors.push(f.key);
    }
  }
  return { fields, fieldErrors };
}

/** P-R03 · mục thiếu (heading vắng / thân rỗng, theo thứ tự `requiredSections`) + kiểm trường. */
export function checkTemplate(
  t: { requiredSections: readonly string[]; fields: readonly FieldDef[] },
  md: string,
): TemplateCheck {
  const map = sectionMap(md);
  const missing = t.requiredSections.filter((s) => {
    const body = map.get(norm(s));
    return body === undefined || body === "";
  });
  if (t.fields.length === 0)
    return { ok: missing.length === 0, missing, fields: null, fieldErrors: [] };
  const { fields, fieldErrors } = parseFields(md, t.fields);
  return { ok: missing.length === 0 && fieldErrors.length === 0, missing, fields, fieldErrors };
}
