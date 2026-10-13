// HUB-FR-66 · AC-H4b2-02 · D3/D6 · hàm thuần: kết quả `POST /providers/:id/check` → câu chữ (bảng "check.* theo kết quả"),
// lỗi request → hành động (đóng hộp + toast / hiện trong hộp), lệnh đăng nhập CLI theo hãng. Không đụng giá trị key.
import type { ProviderCheckResult } from "@ai/contracts/studio";

export type Msg = { key: string; params?: Record<string, unknown> };
export type Tone = "ok" | "error" | "info";

const ERROR_KEY: Record<string, string> = {
  auth_failed: "models.check.fail",
  http_error: "models.check.httpError",
  timeout: "models.check.timeout",
  network: "models.check.network",
  secret_unreadable: "models.check.secretUnreadable",
};

export const runningKey = (sub: boolean) =>
  sub ? "models.check.runningSub" : "models.check.running";

/** Câu tóm tắt của kết quả + tông màu (không chỉ dựa màu: luôn có chữ). */
export function resultText(r: ProviderCheckResult, sub: boolean): Msg & { tone: Tone } {
  if (r.status === "ok") return { key: sub ? "models.check.okSub" : "models.check.ok", tone: "ok" };
  if (r.status === "unsupported") return { key: "models.check.unsupported", tone: "info" };
  if (r.status === "requested") return { key: "models.check.requested", tone: "info" };
  if (sub) return { key: "models.check.failSub", tone: "error" };
  const key = (r.error_code && ERROR_KEY[r.error_code]) || "models.check.fail";
  return { key, params: { status: r.http_status ?? "" }, tone: "error" };
}

/** Dòng trong khối "Chi tiết": HTTP status + lỗi nguyên văn của hãng (server đã che key). `null` ⇒ không hiện khối. */
export function detailText(r: ProviderCheckResult): string | null {
  const lines: string[] = [];
  if (r.http_status !== null) lines.push(`HTTP ${r.http_status}`);
  if (r.message) lines.push(r.message);
  if (r.latency_ms !== null && lines.length > 0) lines.push(`${r.latency_ms} ms`);
  return lines.length > 0 ? lines.join("\n") : null;
}

/** Lỗi request: 404/READONLY/NOT_CONFIGURED ⇒ đóng hộp + toast (404/READONLY làm tươi danh sách); còn lại hiện trong hộp. */
export function failureAction(code: string): { close: boolean; reload: boolean; msg: Msg } {
  if (code === "NOT_FOUND") return { close: true, reload: true, msg: { key: "errors.NOT_FOUND" } };
  if (code === "PROVIDER_READONLY")
    return { close: true, reload: true, msg: { key: "models.errors.providerReadonly" } };
  if (code === "NOT_CONFIGURED")
    return { close: true, reload: false, msg: { key: "errors.NOT_CONFIGURED" } };
  if (code === "NETWORK_ERROR")
    return { close: false, reload: false, msg: { key: "login.err.network" } };
  return {
    close: false,
    reload: false,
    msg: { key: "login.err.server", params: { code: code || "UNKNOWN" } },
  };
}

const LOGIN_VENDORS = new Set(["anthropic", "openai", "google"]);
/** Key i18n của lệnh đăng nhập bước 2 theo hãng (D6); `null` ⇒ hãng khác, hiện `guide.cmd2.other`. */
export const loginCommandKey = (vendor: string): string | null =>
  LOGIN_VENDORS.has(vendor) ? `models.guide.cmd2.${vendor}` : null;
