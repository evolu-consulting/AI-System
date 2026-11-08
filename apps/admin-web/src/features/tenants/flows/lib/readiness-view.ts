// CR-125 · c5b · luật THUẦN hiển thị "mẫu dùng được ở công ty chưa" (đọc kết quả `GET company-flows/readiness/:flowId` của Hub).
// Nói rõ thiếu gì + nút sửa một chạm (chỉ platform) + có cho Gán / Sao chép tiếp không. Không I/O.
import type { ReadinessCode, TemplateReadiness } from "@ai/contracts/modules";

export type FixKind = "enable-feature" | "create-group";
export type ReadinessItem = {
  kind: "feature" | "tool" | "group" | "order" | "locked";
  /** Khoá để sửa (tính năng / mã nhóm) hoặc khoá tool; rỗng với order/locked. */
  key: string;
  stage: string;
  /** Hành động một chạm của platform; null = không có cách sửa từ đây. */
  fix: FixKind | null;
};

const codeOf = (e: unknown): string =>
  typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string"
    ? (e as { code: string }).code
    : "";

const LOAD_CODES = new Set(["HUB_UNCONFIGURED", "FORBIDDEN", "NOT_FOUND"]);
const FIX_CODES = new Set([
  "FEATURE_NOT_NEEDED",
  "CORE_FEATURE_PROTECTED",
  "HUB_UNREACHABLE",
  "NOT_FOUND",
  "FORBIDDEN",
]);

/** Khoá i18n lý do "chưa kiểm được mẫu" theo mã lỗi (mã lạ ⇒ `default`: kiểm kết nối + thử lại). */
export const loadErrorKey = (e: unknown): string =>
  `tenants.companyFlows.readiness.loadFailed.${LOAD_CODES.has(codeOf(e)) ? codeOf(e) : "default"}`;

/** Khoá i18n lỗi của nút sửa một chạm theo mã lỗi (mỗi mã một bước kế tiếp khác nhau). */
export const fixErrorKey = (e: unknown): string =>
  `tenants.companyFlows.readiness.fixError.${FIX_CODES.has(codeOf(e)) ? codeOf(e) : "default"}`;

/** Khoá i18n (MỘT khoá mỗi mã, `check:error-codes`) của mục chặn; nhóm thiếu chỉ là lưu ý, không có mã. */
export const ITEM_CODE: Record<"feature" | "tool" | "order" | "locked", ReadinessCode> = {
  feature: "READINESS_FEATURE_MISSING",
  tool: "READINESS_TOOL_MISSING",
  order: "READINESS_STEP_ORDER",
  locked: "READINESS_STEP_LOCKED",
};

/** Mức hiện: chặn (không gán/sao chép được) hay chỉ lưu ý (nhóm thiếu ⇒ bước mở ra "Chọn người duyệt"). */
export const isBlocking = (i: ReadinessItem): boolean => i.kind !== "group";

export function readinessItems(r: TemplateReadiness, copy: boolean): ReadinessItem[] {
  const out: ReadinessItem[] = [
    ...r.missing.features.map((f) => ({
      kind: "feature" as const,
      key: f.key,
      stage: f.stage,
      fix: "enable-feature" as const,
    })),
    ...r.missing.tools.map((t) => ({
      kind: "tool" as const,
      key: t.key,
      stage: t.stage,
      fix: null,
    })),
    ...r.missing.order.map((o) => ({ kind: "order" as const, key: "", stage: o.stage, fix: null })),
    ...r.missing.groups.map((g) => ({
      kind: "group" as const,
      key: g,
      stage: "",
      fix: "create-group" as const,
    })),
  ];
  // bước cố định: chỉ chặn Sao chép; tên bước đọc từ DỮ LIỆU (`missing.locked`), không tách từ câu chữ
  if (copy)
    for (const stage of r.missing.locked) out.push({ kind: "locked", key: "", stage, fix: null });
  return out;
}

/** Gán (platform) hoặc sao chép (công ty) có bấm tiếp được không. Nhóm thiếu KHÔNG chặn. */
export const canProceed = (r: TemplateReadiness, copy: boolean): boolean =>
  copy ? r.copyable : r.ready;

/** Tên dễ hiểu của tính năng: `<app>-<mức>` ⇒ { app, level }; lạ ⇒ chính khoá. */
export function featureParts(key: string): { app: string; level: "read" | "write" | "admin" | "" } {
  const m = /^(.+)-(read|write|admin)$/.exec(key);
  return m
    ? { app: m[1] as string, level: m[2] as "read" | "write" | "admin" }
    : { app: key, level: "" };
}
