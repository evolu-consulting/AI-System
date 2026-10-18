// HUB-FR-146 · AC-H44 · D2-05 · D2-17 · plan-d2-rules §1, plan-addendum A7: kết quả tool ⇒ `fields` theo khai báo output
// của stage + nội dung .md cố định (`## Kết quả` + `## Bàn giao` + khối ```fields). Thuần, lớp 1.
import { isCalendarDate } from "../runs/start-inputs.rules";

export type ToolFieldDecl = { key: string; type: string; required: boolean };
export type ToolFields = Record<string, string | number>;
export type FilteredFields =
  | { ok: true; fields: ToolFields }
  | { ok: false; why: "not_object" | "missing" | "type" };

/** Trần byte kết quả tool (= `TOOL_RESULT_MAX_BYTES` contract) — kiểm trên byte UTF-8 TRƯỚC `JSON.parse` (S12). */
export const TOOL_RESULT_MAX_BYTES = 65_536;

/** Số byte UTF-8 của chuỗi, không cấp phát bộ đệm (đếm theo code point). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function typeOk(type: string, v: unknown): boolean {
  if (type === "number") return typeof v === "number" && Number.isFinite(v);
  if (type === "date") return typeof v === "string" && isCalendarDate(v);
  return typeof v === "string";
}

/** PD2-U08 · object ⇒ giữ đúng trường khai (bỏ thừa); thiếu required ⇒ `missing`; sai kiểu ⇒ `type`. */
export function filterToolFields(result: unknown, decl: readonly ToolFieldDecl[]): FilteredFields {
  if (typeof result !== "object" || result === null || Array.isArray(result))
    return { ok: false, why: "not_object" };
  const r = result as Record<string, unknown>;
  const fields: ToolFields = {};
  for (const d of decl) {
    const v = r[d.key];
    if (v === undefined || v === null) {
      if (d.required) return { ok: false, why: "missing" };
      continue;
    }
    if (!typeOk(d.type, v)) return { ok: false, why: "type" };
    fields[d.key] = v as string | number;
  }
  return { ok: true, fields };
}

const cell = (v: string | number): string => String(v).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

/** PD2-U09 · A7: bảng theo thứ tự trường; không trường ⇒ "(không có)". */
export function toolOutputMd(stageName: string, fields: Readonly<ToolFields>): string {
  const keys = Object.keys(fields);
  const rows = keys.map((k) => `| ${cell(k)} | ${cell(fields[k] as string | number)} |\n`).join("");
  const list = keys.length > 0 ? keys.join(", ") : "(không có)";
  return (
    `# ${stageName}\n\n## Kết quả\n| Trường | Giá trị |\n|---|---|\n${rows}\n` +
    `## Bàn giao\nĐã gọi tool; trường: ${list}\n\n\`\`\`fields\n${JSON.stringify(fields)}\n\`\`\`\n`
  );
}
