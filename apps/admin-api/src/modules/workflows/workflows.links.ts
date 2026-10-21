// dify-workflows · dựng link Dify console cho workflow (thuần, không I/O). Gốc = env `DIFY_CONSOLE_URL`
// (vắng/rỗng/không phải http(s) ⇒ không link, nút ẩn). Chỉ dùng mã app công khai — KHÔNG bao giờ chứa app-key.
// Editor: app `workflow` → `/app/<id>/workflow`; app `chat`/`agent` → `/app/<id>/configuration`. Log: `/app/<id>/logs`.
export type DifyAppMode = "workflow" | "chat" | "agent";

/** Chuẩn hoá gốc console: trim, bỏ `/` cuối; không phải http(s) hợp lệ ⇒ null. */
export function normalizeConsoleBase(raw: string | undefined | null): string | null {
  const v = (raw ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(v) || !URL.canParse(v)) return null;
  return v;
}

const APP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function appBase(base: string | null | undefined, appId: string | null | undefined): string | null {
  const b = normalizeConsoleBase(base);
  if (!b || !appId || !APP_ID_RE.test(appId)) return null;
  return `${b}/app/${appId}`;
}

/** Link mở editor của app trong Dify console; thiếu gốc hoặc mã app ⇒ null. */
export function difyEditorUrl(
  base: string | null | undefined,
  appId: string | null | undefined,
  mode: DifyAppMode,
): string | null {
  const root = appBase(base, appId);
  if (!root) return null;
  return mode === "workflow" ? `${root}/workflow` : `${root}/configuration`;
}

/** Link trang log của app trong Dify console (Dify không có deep-link theo run id); thiếu gốc/mã app ⇒ null. */
export function difyLogsUrl(
  base: string | null | undefined,
  appId: string | null | undefined,
): string | null {
  const root = appBase(base, appId);
  return root ? `${root}/logs` : null;
}
