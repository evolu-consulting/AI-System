// CR-125 · c5b · luật THUẦN hiển thị "mẫu dùng được ở công ty chưa" (đọc kết quả `GET company-flows/readiness/:flowId` của Hub).
// Nói rõ thiếu gì + nút sửa một chạm (chỉ platform) + có cho Gán / Sao chép tiếp không. Không I/O.
import type { TemplateReadiness } from "@ai/contracts/modules";

export type FixKind = "enable-feature" | "create-group";
export type ReadinessItem = {
  kind: "feature" | "tool" | "group" | "order" | "locked";
  /** Khoá để sửa (tính năng / mã nhóm) hoặc khoá tool; rỗng với order/locked. */
  key: string;
  stage: string;
  /** Hành động một chạm của platform; null = không có cách sửa từ đây. */
  fix: FixKind | null;
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
  if (copy && r.ready && !r.copyable)
    out.push({ kind: "locked", key: "", stage: lockedStage(r), fix: null });
  return out;
}

/** Tên bước cố định đầu tiên (lấy từ câu lý do của Hub: «tên»). */
function lockedStage(r: TemplateReadiness): string {
  return /«([^»]+)»/.exec(r.copyReasons[0] ?? "")?.[1] ?? "";
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
