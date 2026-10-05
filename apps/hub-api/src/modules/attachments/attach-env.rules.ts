// HUB-FR-44 · H2c-R04, AC-15 · env `HUB_ATTACH_*` (plan §7, plan-rules §4). Lỗi: `Error` không chứa giá trị env (chỉ tên
// biến, không chữ số — giá trị có thể là đường dẫn/secret).
import { ATTACH_MAX_BYTES } from "@ai/contracts/chat";

export type AttachEnvInput = {
  HUB_ATTACH_DRIVER?: string;
  HUB_ATTACH_DIR?: string;
  HUB_ATTACH_TENANT_MAX_BYTES?: string;
  HUB_ATTACH_SWEEP_S?: string;
};

export type AttachEnv = { driver: "local"; dir: string; tenantMaxBytes: number; sweepS: number };

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

/** driver = `local`; dir tuyệt đối (theo `platform`); hạn tenant ≥ `ATTACH_MAX_BYTES` (vắng 5 GiB); sweep 10–86 400 s (vắng 600). */
export function parseAttachEnv(e: AttachEnvInput, platform: NodeJS.Platform): AttachEnv {
  if (e.HUB_ATTACH_DRIVER !== "local")
    throw new Error("HUB_ATTACH_DRIVER không hợp lệ (driver hỗ trợ: local)");
  const dir = e.HUB_ATTACH_DIR;
  if (!dir || !isAbsoluteFor(dir, platform))
    throw new Error("HUB_ATTACH_DIR phải là đường dẫn tuyệt đối");
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
  return { driver: "local", dir, tenantMaxBytes, sweepS };
}
