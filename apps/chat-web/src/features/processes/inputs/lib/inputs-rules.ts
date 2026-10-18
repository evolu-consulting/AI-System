// HUB-FR-124 · AC-H37 · PB-R13 · luật thuần của form `!key`: có form không, giá trị rỗng, dựng `inputs` cho request, validate nhánh.
import { PROCESS_INPUT_MAX } from "@ai/contracts/chat";
import type {
  ProcessInputDef,
  ProcessInputValue,
  ProcessSourceChip,
} from "@ai/contracts/hub-admin";
import { isIsoCalendarDate } from "../../domain/date-input";

/** Trần độ dài tên nhánh (SOURCE_BRANCH_MAX của contract nguồn). */
export const BRANCH_MAX = 255;

/** Giá trị một trường: `value` = chữ / lựa chọn / `attachment_id` / `source_key`; `fileName` chỉ để hiển thị; `branch` cho source_ref. */
export type FieldValue = { value: string; fileName: string; branch: string };
export type InputValues = Record<string, FieldValue>;

export const needsForm = (item: { inputs?: readonly unknown[] }): boolean =>
  (item.inputs?.length ?? 0) > 0;

export const emptyValues = (defs: readonly ProcessInputDef[]): InputValues =>
  Object.fromEntries(defs.map((d) => [d.key, { value: "", fileName: "", branch: "" }]));

export type BranchError = "required" | "dash" | "tooLong";
/** Lỗi theo trường: nhánh nguồn, chữ quá dài, hoặc ngày không có thật (T11c, `date`). */
export type FieldError = "tooLong" | BranchError | "dateInvalid";

/** Chưa chọn nguồn ⇒ hợp lệ (trường bỏ trống). Đã chọn ⇒ nhánh 1..255 ký tự, không bắt đầu `-` (PB-R19). */
export function validateSourceRef(sourceKey: string, branch: string): BranchError | null {
  if (!sourceKey) return null;
  const b = branch.trim();
  if (!b) return "required";
  if (b.startsWith("-")) return "dash";
  if (b.length > BRANCH_MAX) return "tooLong";
  return null;
}

/** Chữ tối đa PROCESS_INPUT_MAX. */
export const textTooLong = (v: string): boolean => v.length > PROCESS_INPUT_MAX;

/** Lỗi đầu tiên theo khoá trường (đủ để chặn gửi); rỗng ⇒ gửi được. */
export function fieldErrors(
  defs: readonly ProcessInputDef[],
  values: InputValues,
): Record<string, FieldError> {
  const out: Record<string, FieldError> = {};
  for (const d of defs) {
    const v = values[d.key];
    if (!v) continue;
    if (d.type === "text" && textTooLong(v.value)) out[d.key] = "tooLong";
    if (d.type === "date" && v.value.trim() && !isIsoCalendarDate(v.value.trim()))
      out[d.key] = "dateInvalid";
    if (d.type === "source_ref") {
      const e = validateSourceRef(v.value, v.branch);
      if (e) out[d.key] = e;
    }
  }
  return out;
}

/** Bỏ trường rỗng (thiếu bắt buộc KHÔNG chặn — agent hỏi lại, AC-H37); ghép `type` theo khai báo. */
export function toRequestInputs(
  defs: readonly ProcessInputDef[],
  values: InputValues,
): ProcessInputValue[] {
  const out: ProcessInputValue[] = [];
  for (const d of defs) {
    const v = values[d.key];
    if (!v) continue;
    const val = v.value.trim();
    if (!val) continue;
    if (d.type === "text") out.push({ type: "text", key: d.key, text: v.value.trim() });
    else if (d.type === "select") out.push({ type: "select", key: d.key, value: v.value });
    else if (d.type === "date") out.push({ type: "date", key: d.key, value: val });
    else if (d.type === "file") out.push({ type: "file", key: d.key, attachment_id: v.value });
    else if (v.branch.trim())
      out.push({ type: "source_ref", key: d.key, source_key: v.value, branch: v.branch.trim() });
  }
  return out;
}

/** Chỉ nguồn Git (giá trị `source_ref` chỉ nhận `git_remote`, C19). */
export const gitChips = (chips: readonly ProcessSourceChip[]): ProcessSourceChip[] =>
  chips.filter((c) => c.kind === "git_remote");

export type SubmitErrorKey = { key: string; params?: Record<string, string | number> };

/**
 * 400 `VALIDATION_ERROR` path `inputs.<i>.value` (i = chỉ số trong mảng ĐÃ GỬI) → khoá các trường `date` bị từ chối
 * (lỗi hiện dưới trường, không dùng câu "Nguồn hoặc nhánh…").
 */
export function serverDateErrors(
  sent: readonly ProcessInputValue[],
  issuePaths: readonly string[],
): string[] {
  const keys: string[] = [];
  for (const p of issuePaths) {
    const m = /^inputs\.(\d+)\.value$/.exec(p);
    const item = m ? sent[Number(m[1])] : undefined;
    if (item?.type === "date") keys.push(item.key);
  }
  return keys;
}

/** Mã lỗi `POST /process-runs` → khoá i18n (đầy đủ, gồm `process.`). Mã lạ ⇒ câu chung. */
export function submitErrorKey(code: string, processKey: string, max: number): SubmitErrorKey {
  switch (code) {
    case "SOURCE_UNRESOLVABLE":
      return { key: "process.inputs.err.sourceUnresolvable" };
    case "VALIDATION_ERROR":
      return { key: "process.inputs.err.sourceInvalid" };
    case "PROCESS_NOT_FOUND":
      return { key: "process.composer.error.notFound", params: { key: processKey } };
    case "TOO_MANY_PROCESS_RUNS":
      return { key: "process.composer.error.tooMany", params: { max } };
    default:
      return { key: "process.inputs.err.generic" };
  }
}
