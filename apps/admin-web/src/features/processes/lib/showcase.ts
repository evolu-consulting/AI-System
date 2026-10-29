// CR-103 · R4 fnr-showcase: logic thuần của trang `/processes/showcase` — form input → `inputs[]` của start-run, kiểm nhanh,
// danh sách họ node (R3 sẽ thay phần "đổi được" bằng `canSwap`).
import type { ProcessInputDef, ProcessInputValue } from "@ai/contracts/hub-admin";

export type InputIssue = "required" | "number";

/** Số hợp lệ (chuỗi số hữu hạn) — cùng điều kiện luật domain lúc start (`Number.isFinite(Number(value.trim()))`). */
const isNum = (s: string): boolean => s.trim() !== "" && Number.isFinite(Number(s.trim()));

/** Lỗi theo key input (rỗng ⇒ gửi được). Chỉ kiểu showcase dùng: text, select, number, date. */
export function inputIssues(
  defs: readonly ProcessInputDef[],
  raw: Readonly<Record<string, string>>,
): Record<string, InputIssue> {
  const out: Record<string, InputIssue> = {};
  for (const d of defs) {
    const v = (raw[d.key] ?? "").trim();
    if (d.type === "number" && v !== "" && !isNum(v)) out[d.key] = "number";
    else if (d.required && v === "") out[d.key] = "required";
  }
  return out;
}

/** Giá trị gửi lên `POST /process-defs/:id/run`; input rỗng không bắt buộc ⇒ bỏ qua; kiểu file/source_ref không hỗ trợ. */
export function toInputValues(
  defs: readonly ProcessInputDef[],
  raw: Readonly<Record<string, string>>,
): ProcessInputValue[] {
  const out: ProcessInputValue[] = [];
  for (const d of defs) {
    const v = (raw[d.key] ?? "").trim();
    if (v === "") continue;
    if (d.type === "number") out.push({ type: "number", key: d.key, value: v });
    else if (d.type === "date") out.push({ type: "date", key: d.key, value: v });
    else if (d.type === "select") out.push({ type: "select", key: d.key, value: v });
    else if (d.type === "text") out.push({ type: "text", key: d.key, text: v });
  }
  return out;
}

/** Hai kịch bản mẫu của spec (nhánh Giám đốc / nhánh Hoàn tất) — điền sẵn form. */
export const SHOWCASE_PRESETS = [
  { id: "director", values: { amount: "150000000", purpose: "mua sắm" } },
  { id: "done", values: { amount: "50000000", purpose: "mua sắm" } },
] as const;

export type NodeFamily = "work" | "wait" | "apply" | "control";
/** Họ node (design §2). `swappable`: họ có > 1 loại ⇒ đổi qua lại được (R3 sẽ kiểm bằng `canSwap`). */
export const NODE_FAMILIES: readonly { family: NodeFamily; kinds: readonly string[] }[] = [
  { family: "work", kinds: ["agent", "team", "tool", "set"] },
  { family: "wait", kinds: ["wait_until"] },
  { family: "apply", kinds: ["apply"] },
  { family: "control", kinds: ["if"] },
];
export const swappable = (family: NodeFamily): boolean =>
  (NODE_FAMILIES.find((f) => f.family === family)?.kinds.length ?? 0) > 1;
