// ADM-FR-68 · PB-R21 · FS5 · hàm thuần trình bày nguồn: tách cấu hình đầy đủ / công khai, nhãn Đích + Trạng thái, dung lượng.
// Rò `path`: CHỈ `localPathOf` được đọc `config.path` (kể cả khi server lỡ gửi); mọi nơi khác không đụng tới.

import type { Role } from "@ai/contracts";
import type {
  SourceCheckResult,
  SourceConfig,
  SourceConfigPublic,
  SourceKind,
  SourcePin,
  SourcePinPublic,
  SourceView,
} from "@ai/contracts/hub-admin";

export type AnyConfig = SourceConfig | SourceConfigPublic;
export type AnyPin = SourcePin | SourcePinPublic;

/** `path` của nguồn local_path nếu (và chỉ nếu) có trong cấu hình; tenant_admin luôn `null`. */
export function localPathOf(config: AnyConfig, role: Role | undefined): string | null {
  if (role !== "platform_admin") return null; // không bao giờ render path cho vai khác (PB-R21)
  if (config.kind !== "local_path" || !("path" in config)) return null;
  return typeof config.path === "string" ? config.path : null;
}

/** Cấu hình đầy đủ (có thể gửi PUT) hoặc `null` khi là bản công khai của local_path. */
export function toFullConfig(config: AnyConfig): SourceConfig | null {
  if (config.kind === "local_path") return "path" in config ? (config as SourceConfig) : null;
  return config;
}

/** tenant_admin + local_path ⇒ chỉ được xem (không sửa, không kiểm tra, không xoá). */
export const isViewOnly = (kind: SourceKind, role: Role | undefined): boolean =>
  kind === "local_path" && role !== "platform_admin";

/** Rút gọn `https://host/a/b.git` → `host/a/b`. URL lỗi ⇒ trả nguyên chuỗi. */
export function shortGitTarget(url: string, branch: string): string {
  let short = url;
  try {
    const u = new URL(url);
    short = `${u.host}${u.pathname}`.replace(/\.git$/, "").replace(/\/$/, "");
  } catch {
    // giữ nguyên
  }
  return `${short}@${branch}`;
}

export type PinLabel = { kind: "text"; value: string } | { kind: "snapshot" };

/** Nhãn ghim của cột Trạng thái: git ⇒ 7 ký tự SHA; library ⇒ 8 ký tự version; local ⇒ "snapshot"; chưa kiểm tra ⇒ `null`. */
export function pinLabel(pin: AnyPin | null): PinLabel | null {
  if (!pin) return null;
  if (pin.kind === "git_remote") return { kind: "text", value: pin.sha.slice(0, 7) };
  if (pin.kind === "library") return { kind: "text", value: pin.version.slice(0, 8) };
  return { kind: "snapshot" };
}

/** `1536` → `1,5 KB` (dùng chấm thập phân của `Intl`, không phụ thuộc locale để test ổn định). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export type CheckSummary =
  | { key: "check.okGit"; params: { branch: string; sha: string; files: number; size: string } }
  | { key: "check.okLibrary"; params: { version: string; files: number; size: string } }
  | { key: "check.okLocal"; params: { files: number; size: string } };

/** Kết quả 200 của "Kiểm tra kết nối" → khoá + tham số i18n. `branch` lấy từ cấu hình đã lưu (pin không có branch). */
export function summarizeCheck(res: SourceCheckResult, branch: string | undefined): CheckSummary {
  const size = formatBytes(res.bytes);
  const pin = res.pin;
  if (pin.kind === "git_remote") {
    return {
      key: "check.okGit",
      params: { branch: branch ?? "", sha: pin.sha.slice(0, 7), files: res.files, size },
    };
  }
  if (pin.kind === "library") {
    return {
      key: "check.okLibrary",
      params: { version: pin.version.slice(0, 8), files: res.files, size },
    };
  }
  return { key: "check.okLocal", params: { files: res.files, size } };
}

/** Lọc phía client theo ký hiệu (API không có tham số `q`). */
export function filterByKey(rows: SourceView[], q: string): SourceView[] {
  const needle = q.trim().toLowerCase();
  return needle === "" ? rows : rows.filter((r) => r.key.includes(needle));
}
