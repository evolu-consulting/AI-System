// HUB-FR-44 · HUB-FR-138 · HUB-FR-141 · H2c-R04 · FB1 §3.6, §3.8 · env `HUB_ATTACH_*` + `FILEBOX_*` (driver `local`|`filebox`).
// Lỗi: `Error` chỉ chứa TÊN biến, không chứa giá trị (có thể là đường dẫn/secret/URL — AC-09 e3).
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";

export type AttachEnvInput = {
  APP_ENV?: string;
  HUB_ATTACH_DRIVER?: string;
  HUB_ATTACH_DIR?: string;
  HUB_ATTACH_TENANT_MAX_BYTES?: string;
  HUB_ATTACH_SWEEP_S?: string;
  FILEBOX_URL?: string;
  FILEBOX_ORG?: string;
  FILEBOX_CA?: string;
  FILEBOX_TOKEN?: string;
  FILEBOX_TIMEOUT_MS?: string;
  /** Danh sách host nội bộ (tên service Docker, phân tách phẩy) được dùng `http` — FileBox riêng trong mạng nội bộ (không cổng host). */
  FILEBOX_HTTP_HOSTS?: string;
  /** Tiền tố đường dẫn công khai (vd `/_fb`) thay origin trong link tải gửi trình duyệt; nginx proxy `<prefix>/d/…` tới FileBox nội bộ. */
  FILEBOX_PUBLIC_PATH?: string;
};

export type LocalAttachEnv = {
  driver: "local";
  dir: string;
  tenantMaxBytes: number;
  sweepS: number;
};
/** FB1 (core-only): kho FileBox; Bearer đọc từ ENV `FILEBOX_TOKEN` ở server (không parse ở đây để không vào AttachEnv/log). */
export type FileboxAttachEnv = {
  driver: "filebox";
  url: string;
  org: string;
  caPath?: string;
  publicPath?: string;
  timeoutMs: number;
  tenantMaxBytes: number;
  sweepS: number;
};
export type AttachEnv = LocalAttachEnv | FileboxAttachEnv;

export const DEFAULT_TENANT_MAX_BYTES = 5_368_709_120;
export const DEFAULT_SWEEP_S = 600;
export const DEFAULT_FILEBOX_TIMEOUT_MS = 30_000;
const SWEEP_MIN_S = 10;
const SWEEP_MAX_S = 86_400;
const DECIMAL_RE = /^[0-9]+$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
/** = `path.win32.isAbsolute` / `path.posix.isAbsolute` (rules thuần: không import `node:path`). */
const WIN_ABS_RE = /^([A-Za-z]:)?[\\/]/;

export function isAbsoluteFor(dir: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? WIN_ABS_RE.test(dir) : dir.startsWith("/");
}

/** Số nguyên thập phân không dấu trong `[min, max]`; vắng → `fallback`; sai → null. */
function intIn(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (!DECIMAL_RE.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

function commonLimits(e: AttachEnvInput): { tenantMaxBytes: number; sweepS: number } {
  const tenantMaxBytes = intIn(
    e.HUB_ATTACH_TENANT_MAX_BYTES,
    DEFAULT_TENANT_MAX_BYTES,
    ATTACH_MAX_BYTES,
    Number.MAX_SAFE_INTEGER,
  );
  if (tenantMaxBytes === null)
    throw new Error(
      "HUB_ATTACH_TENANT_MAX_BYTES phải là số nguyên byte, không nhỏ hơn cỡ file tối đa",
    );
  const sweepS = intIn(e.HUB_ATTACH_SWEEP_S, DEFAULT_SWEEP_S, SWEEP_MIN_S, SWEEP_MAX_S);
  if (sweepS === null)
    throw new Error("HUB_ATTACH_SWEEP_S phải là số nguyên giây trong khoảng cho phép");
  return { tenantMaxBytes, sweepS };
}

/** `dir` trống + development/test + có `devDir` ⇒ dùng `devDir` (thư mục tạm dev); production/khác ⇒ bắt buộc tuyệt đối. */
function requireDir(
  dir: string | undefined,
  platform: NodeJS.Platform,
  appEnv: string | undefined,
  devDir: string | undefined,
): string {
  if (!dir && devDir && (appEnv === "development" || appEnv === "test")) return devDir;
  if (!dir || !isAbsoluteFor(dir, platform))
    throw new Error("HUB_ATTACH_DIR phải là đường dẫn tuyệt đối");
  return dir;
}

/** `https` bắt buộc trừ khi host loopback (http dev/mock) hoặc host nằm TƯỜNG MINH trong `FILEBOX_HTTP_HOSTS`
 * (FileBox riêng chạy cùng mạng Docker nội bộ, không publish cổng ⇒ http trong mạng kín; không dành cho host công khai).
 * Chỉ nêu TÊN biến khi lỗi (không giá trị). */
function parseFileboxUrl(raw: string | undefined, httpHosts: string | undefined): string {
  if (!raw) throw new Error("FILEBOX_URL bắt buộc khi HUB_ATTACH_DRIVER=filebox");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("FILEBOX_URL không phải URL hợp lệ");
  }
  const allowed = new Set(
    (httpHosts ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
  const loop = LOOPBACK.has(u.hostname) || allowed.has(u.hostname.toLowerCase());
  if (u.protocol !== "https:" && !(u.protocol === "http:" && loop))
    throw new Error("FILEBOX_URL phải là https (http chỉ cho loopback hoặc host trong FILEBOX_HTTP_HOSTS)");
  return raw;
}

function parseFilebox(e: AttachEnvInput): FileboxAttachEnv {
  const url = parseFileboxUrl(e.FILEBOX_URL, e.FILEBOX_HTTP_HOSTS);
  const publicPath = e.FILEBOX_PUBLIC_PATH?.replace(/\/+$/, "");
  if (publicPath && !/^\/[A-Za-z0-9._~/-]+$/.test(publicPath))
    throw new Error("FILEBOX_PUBLIC_PATH phải là đường dẫn bắt đầu bằng /");
  if (!e.FILEBOX_ORG) throw new Error("FILEBOX_ORG bắt buộc khi HUB_ATTACH_DRIVER=filebox");
  // Chỉ kiểm sự hiện diện (fail-closed sớm); KHÔNG lưu giá trị vào AttachEnv (tránh lọt log). Server đọc thẳng `env.FILEBOX_TOKEN`.
  if (!e.FILEBOX_TOKEN) throw new Error("FILEBOX_TOKEN bắt buộc khi HUB_ATTACH_DRIVER=filebox");
  const timeoutMs = intIn(e.FILEBOX_TIMEOUT_MS, DEFAULT_FILEBOX_TIMEOUT_MS, 1_000, 600_000);
  if (timeoutMs === null) throw new Error("FILEBOX_TIMEOUT_MS phải là số nguyên mili-giây");
  return {
    driver: "filebox",
    url,
    org: e.FILEBOX_ORG,
    ...(e.FILEBOX_CA ? { caPath: e.FILEBOX_CA } : {}),
    ...(publicPath ? { publicPath } : {}),
    timeoutMs,
    ...commonLimits(e),
  };
}

/** driver `local` (dir tuyệt đối) hoặc `filebox` (FILEBOX_URL https/loopback + org); driver lạ ⇒ ném. */
export function parseAttachEnv(
  e: AttachEnvInput,
  platform: NodeJS.Platform,
  devDir?: string,
): AttachEnv {
  if (e.HUB_ATTACH_DRIVER === "filebox") return parseFilebox(e);
  if (e.HUB_ATTACH_DRIVER !== "local")
    throw new Error("HUB_ATTACH_DRIVER không hợp lệ (driver hỗ trợ: local, filebox)");
  const dir = requireDir(e.HUB_ATTACH_DIR, platform, e.APP_ENV, devDir);
  return { driver: "local", dir, ...commonLimits(e) };
}
