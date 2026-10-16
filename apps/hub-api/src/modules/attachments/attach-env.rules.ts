// HUB-FR-44 · H2c-R04, AC-15 · env `HUB_ATTACH_*` (plan §7, plan-rules §4). Lỗi: `Error` không chứa giá trị env (chỉ tên
// biến, không chữ số — giá trị có thể là đường dẫn/secret).
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";

export type AttachEnvInput = {
  HUB_ATTACH_DRIVER?: string;
  HUB_ATTACH_DIR?: string;
  HUB_ATTACH_TENANT_MAX_BYTES?: string;
  HUB_ATTACH_SWEEP_S?: string;
  /** Driver `filebox` (CR-filebox): API v1 của FileBox — xem `storage.filebox.ts`. */
  FILEBOX_URL?: string;
  FILEBOX_TOKEN?: string;
  FILEBOX_ORG?: string;
  FILEBOX_CA?: string;
};

type Limits = { tenantMaxBytes: number; sweepS: number };
export type LocalAttachEnv = { driver: "local"; dir: string } & Limits;
export type FileboxAttachEnv = {
  driver: "filebox";
  url: string;
  token: string;
  org: string;
  ca?: string;
} & Limits;
export type AttachEnv = LocalAttachEnv | FileboxAttachEnv;

export const DEFAULT_TENANT_MAX_BYTES = 5_368_709_120;
export const DEFAULT_SWEEP_S = 600;
const SWEEP_MIN_S = 10;
const SWEEP_MAX_S = 86_400;
const DECIMAL_RE = /^[0-9]+$/;
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

/**
 * driver `local`: dir tuyệt đối (theo `platform`). driver `filebox`: `FILEBOX_URL` https (http chỉ máy cục bộ), `FILEBOX_TOKEN`,
 * `FILEBOX_ORG` 1–200 ký tự, `FILEBOX_CA` tuỳ chọn (tuyệt đối). Chung: hạn tenant ≥ `ATTACH_MAX_BYTES` (vắng 5 GiB); sweep
 * 10–86 400 s (vắng 600).
 */
export function parseAttachEnv(e: AttachEnvInput, platform: NodeJS.Platform): AttachEnv {
  if (e.HUB_ATTACH_DRIVER === "filebox")
    return { driver: "filebox", ...parseFilebox(e, platform), ...parseLimits(e) };
  if (e.HUB_ATTACH_DRIVER !== "local")
    throw new Error("HUB_ATTACH_DRIVER không hợp lệ (driver hỗ trợ: local, filebox)");
  const dir = e.HUB_ATTACH_DIR;
  if (!dir || !isAbsoluteFor(dir, platform))
    throw new Error("HUB_ATTACH_DIR phải là đường dẫn tuyệt đối");
  return { driver: "local", dir, ...parseLimits(e) };
}

function parseLimits(e: AttachEnvInput): Limits {
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

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Ký tự của khoá Bearer (RFC 6750 b64token), 16–512. */
const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{16,512}$/;
const ORG_MAX = 200;

/** URL gốc FileBox (bỏ `/` cuối), khoá, org (trim), CA tuyệt đối. Lỗi chỉ nêu tên biến. */
function parseFilebox(
  e: AttachEnvInput,
  platform: NodeJS.Platform,
): Pick<FileboxAttachEnv, "url" | "token" | "org" | "ca"> {
  const url = URL.canParse(e.FILEBOX_URL ?? "") ? new URL(e.FILEBOX_URL as string) : null;
  const okUrl =
    url !== null &&
    (url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)));
  if (!okUrl) throw new Error("FILEBOX_URL phải là URL https của FileBox");
  if (!TOKEN_RE.test(e.FILEBOX_TOKEN ?? "")) throw new Error("FILEBOX_TOKEN thiếu hoặc sai dạng");
  const org = (e.FILEBOX_ORG ?? "").trim();
  if (org.length < 1 || org.length > ORG_MAX) throw new Error("FILEBOX_ORG phải dài 1–200 ký tự");
  const ca = e.FILEBOX_CA;
  if (ca !== undefined && !isAbsoluteFor(ca, platform))
    throw new Error("FILEBOX_CA phải là đường dẫn tuyệt đối");
  const out = {
    url: url.origin + url.pathname.replace(/\/+$/, ""),
    token: e.FILEBOX_TOKEN as string,
    org,
  };
  return ca === undefined ? out : { ...out, ca };
}
