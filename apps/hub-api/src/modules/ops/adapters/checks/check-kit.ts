// CR-104 · ops-checks · đồ nghề dùng chung của các check: ngưỡng (cấu hình ∥ mặc định meta), đọc file trạng thái do host ghi
// (zod, sai định dạng ⇒ `unknown`), danh sách host công khai, và làm sạch chuỗi lỗi thô trước khi hiện lên thẻ.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { OPS_CHECK_META, type OpsCheckKey, type OpsCheckSettings } from "@ai/contracts/hub-admin";
import type { z } from "zod";
import type { OpsCheckDeps } from "../../application/ops.check";

/** Ngưỡng hiệu lực: cấu hình trên UI; `null` ⇒ mặc định của meta (check không dùng mức đó ⇒ `null`). */
export function thresholds(
  key: OpsCheckKey,
  cfg: OpsCheckSettings,
): { warn: number | null; crit: number | null } {
  const m = OPS_CHECK_META[key];
  return {
    warn: cfg.warn ?? m.warn?.default ?? null,
    crit: cfg.crit ?? m.crit?.default ?? null,
  };
}

export const DEFAULT_STATUS_DIR = "/run/s2/ops";
export const statusDirOf = (d: Pick<OpsCheckDeps, "statusDir">): string =>
  d.statusDir ?? process.env.HUB_OPS_STATUS_DIR ?? DEFAULT_STATUS_DIR;

export type StatusFile<T> =
  | { kind: "missing" }
  | { kind: "invalid"; reason: string }
  | { kind: "ok"; data: T };

/** Đọc + kiểm `<statusDir>/<name>`; không ném lỗi (thiếu/hỏng ⇒ kết quả có kiểu). */
export async function readStatusFile<S extends z.ZodType>(
  d: Pick<OpsCheckDeps, "statusDir">,
  name: string,
  schema: S,
): Promise<StatusFile<z.infer<S>>> {
  let raw: string;
  try {
    raw = await readFile(join(statusDirOf(d), name), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" };
    return { kind: "invalid", reason: "không đọc được file" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "invalid", reason: "không phải JSON" };
  }
  const r = schema.safeParse(json);
  if (!r.success) return { kind: "invalid", reason: "sai định dạng" };
  return { kind: "ok", data: r.data };
}

/** 5 host công khai: `OPS_PUBLIC_URLS` (danh sách phẩy) ∥ các `S2_PUBLIC_*_URL` đã đặt; rỗng ⇒ chưa cấu hình. */
const S2_ENVS = [
  "S2_PUBLIC_CONTRACTS_URL",
  "S2_PUBLIC_CHAT_URL",
  "S2_PUBLIC_ADMIN_URL",
  "S2_PUBLIC_HUB_URL",
  "S2_PUBLIC_COMMUNITY_URL",
] as const;

export function publicUrlsFromEnv(env: Record<string, string | undefined> = process.env): URL[] {
  const listed = (env.OPS_PUBLIC_URLS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const raw = listed.length > 0 ? listed : S2_ENVS.map((k) => env[k]?.trim() ?? "").filter(Boolean);
  const out: URL[] = [];
  for (const s of raw) {
    try {
      const u = new URL(s);
      if (u.protocol === "http:" || u.protocol === "https:") out.push(u);
    } catch {
      // URL sai ⇒ bỏ qua
    }
  }
  return out;
}

/** Bỏ đường dẫn, token/khoá dài, `Bearer …` khỏi chuỗi lỗi thô rồi cắt ngắn — không rò `last_error` nguyên văn. */
export function scrub(s: string | null | undefined, max = 80): string {
  if (!s) return "";
  const t = s
    .replace(/Bearer\s+\S+/gi, "[ẩn]")
    .replace(/\b(sk|pk|ghp|xox[a-z])-[\w-]{6,}/gi, "[ẩn]")
    .replace(/[A-Za-z]:\\[^\s'"]*/g, "[đường dẫn]")
    .replace(/(?:\/[\w.@-]+){2,}/g, "[đường dẫn]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[ẩn]")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export const minutesBetween = (later: Date, earlier: Date): number =>
  (later.getTime() - earlier.getTime()) / 60_000;
