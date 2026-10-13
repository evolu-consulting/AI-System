// HUB-FR-131 · HUB-FR-132 · HUB-BR-40 · K1-AC01 · CR-073 · plan K1 §2.2 + §3.1 (6 bước; 7 lỗi + 5 cảnh báo), §11 G5–G7:
// luật thuần "Kiểm tra" kết nối KH — gom kết quả từng bước (`KhProbe`) thành `KhCheckResult`, và quyết định còn bước kế
// không (dừng sau mục "dừng"). Không I/O; dịch vụ (`kh.check.service.ts`) gọi KH và điền probe theo thứ tự.
import {
  KH_PROJECTS_MAX,
  type KhCheckCode,
  type KhCheckItem,
  type KhCheckResult,
} from "@ai/contracts/hub-admin";
import {
  embedderEnglishOnly,
  type KhUrlResult,
  khVersionOk,
  parseKhProjects,
  parseKhVersion,
} from "./kh.rules";

export type KhHit = { status: number; body: unknown } | "timeout" | "network";
export type KhProbe = {
  url: KhUrlResult;
  /** Bước 2 `GET /health` (không khoá) — `body.model`. */
  health: KhHit | null;
  /** Bước 3 `GET /version` không khoá — phải 401. */
  versionNoKey: KhHit | null;
  /** Bước 4 `useSecret` đọc khoá. */
  key: "ok" | "unreadable" | null;
  /** Bước 5 `GET /version` có khoá. */
  versionWithKey: KhHit | null;
  /** Bước 6 `GET /projects` có khoá. */
  projects: KhHit | null;
  summaryProject: string | null;
};

type Acc = {
  items: KhCheckItem[];
  localDev: boolean;
  khVersion: string | null;
  embedder: string | null;
  projects: string[];
  summaryProject: string | null;
};
/** `missing` = bước chưa chạy; `stop` = mục "dừng"; `next` = đi tiếp. */
type Step = "missing" | "stop" | "next";
type Params = Record<string, string | number>;

const KH_VERSION_MAX = 64;
const EMBEDDER_MAX = 200;

const err = (a: Acc, code: KhCheckCode, params?: Params): void => {
  a.items.push(params ? { code, level: "error", params } : { code, level: "error" });
};
const warn = (a: Acc, code: KhCheckCode, params?: Params): void => {
  a.items.push(params ? { code, level: "warning", params } : { code, level: "warning" });
};
const is2xx = (s: number): boolean => s >= 200 && s < 300;
const bodyField = (body: unknown, k: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[k] : undefined;

/** Timeout ⇒ `kh_timeout`; network ⇒ `kh_unreachable` (không status). Trả `true` khi đã ghi lỗi. */
function transportFail(a: Acc, h: KhHit): h is "timeout" | "network" {
  if (h === "timeout") err(a, "kh_timeout");
  else if (h === "network") err(a, "kh_unreachable");
  else return false;
  return true;
}

function stepUrl(a: Acc, p: Partial<KhProbe>): Step {
  if (!p.url) return "missing";
  if (!p.url.ok) {
    err(a, "kh_url_not_allowed", { reason: p.url.reason });
    return "stop";
  }
  a.localDev = p.url.localDev;
  return "next";
}

function stepHealth(a: Acc, p: Partial<KhProbe>): Step {
  const h = p.health;
  if (!h) return "missing";
  if (transportFail(a, h)) return "stop";
  if (h.status !== 200) {
    err(a, "kh_unreachable", { status: h.status });
    return "stop";
  }
  const model = bodyField(h.body, "model");
  a.embedder = typeof model === "string" && model !== "" ? model.slice(0, EMBEDDER_MAX) : null;
  if (embedderEnglishOnly(a.embedder)) warn(a, "kh_embedder_english", { model: a.embedder ?? "" });
  return "next";
}

/** G6 · `/version` không khoá phải 401; 2xx = KH tắt xác thực ⇒ lỗi dừng (loopback dev ⇒ chỉ cảnh báo). */
function stepAuthOn(a: Acc, p: Partial<KhProbe>): Step {
  const h = p.versionNoKey;
  if (!h) return "missing";
  if (transportFail(a, h)) return "stop";
  if (h.status === 401) return "next";
  if (!is2xx(h.status)) {
    err(a, "kh_unreachable", { status: h.status });
    return "stop";
  }
  if (!a.localDev) {
    err(a, "kh_auth_disabled");
    return "stop";
  }
  warn(a, "kh_auth_disabled_dev");
  return "next";
}

function stepKey(a: Acc, p: Partial<KhProbe>): Step {
  if (!p.key) return "missing";
  if (p.key === "ok") return "next";
  err(a, "kh_key_invalid");
  return "stop";
}

/** G5 · `found` = chuỗi gốc của KH; không phải chuỗi ⇒ `String(raw)`. Phiên bản cũ không dừng. */
function stepVersion(a: Acc, p: Partial<KhProbe>): Step {
  const h = p.versionWithKey;
  if (!h) return "missing";
  if (transportFail(a, h)) return "stop";
  if (h.status === 401 || h.status === 403) {
    err(a, "kh_key_rejected");
    return "stop";
  }
  if (!is2xx(h.status)) {
    err(a, "kh_unreachable", { status: h.status });
    return "stop";
  }
  const raw = bodyField(h.body, "version");
  a.khVersion = typeof raw === "string" && raw !== "" ? raw.slice(0, KH_VERSION_MAX) : null;
  if (!khVersionOk(parseKhVersion(raw)))
    err(a, "kh_version_too_old", { found: String(raw).slice(0, KH_VERSION_MAX) });
  return "next";
}

/** `summary_project` (nếu khoá thấy) đứng đầu, rồi tên tăng; cắt 50. */
function orderProjects(ids: readonly string[], summary: string | null): string[] {
  const head = summary !== null && ids.includes(summary) ? [summary] : [];
  return [...head, ...ids.filter((i) => i !== summary)].slice(0, KH_PROJECTS_MAX);
}

function stepProjects(a: Acc, p: Partial<KhProbe>): Step {
  const h = p.projects;
  if (!h) return "missing";
  if (transportFail(a, h)) return "stop";
  const ids = is2xx(h.status) ? parseKhProjects(h.body) : null;
  if (ids === null) {
    err(a, "kh_unreachable", { status: h.status });
    return "stop";
  }
  if (ids.length === 0) warn(a, "kh_projects_empty");
  if (ids.length > KH_PROJECTS_MAX) warn(a, "kh_projects_many", { count: ids.length });
  const sp = a.summaryProject;
  if (sp !== null && !ids.includes(sp)) warn(a, "kh_summary_project_missing", { project_id: sp });
  a.projects = orderProjects(ids, sp);
  return "next";
}

const STEPS = [stepUrl, stepHealth, stepAuthOn, stepKey, stepVersion, stepProjects] as const;

/** Chạy các bước đã có; dừng ở bước chưa chạy (`missing`) hoặc mục "dừng". */
function walk(p: Partial<KhProbe>): { acc: Acc; last: Step } {
  const acc: Acc = {
    items: [],
    localDev: false,
    khVersion: null,
    embedder: null,
    projects: [],
    summaryProject: p.summaryProject ?? null,
  };
  let last: Step = "next";
  for (const step of STEPS) {
    last = step(acc, p);
    if (last !== "next") break;
  }
  return { acc, last };
}

/**
 * Còn bước kế không: `false` sau mục "dừng" (URL bị chặn, /health lỗi, KH tắt xác thực, khoá không đọc được / bị từ chối,
 * timeout bất kỳ…) hoặc khi đã chạy hết 6 bước; `true` khi bước kế chưa chạy.
 */
export function khCheckShouldContinue(p: Partial<KhProbe>): boolean {
  return walk(p).last === "missing";
}

/** Bảng plan §3.1 ⇒ `KhCheckResult`. G7 · dừng sớm (trước khi xong bước 5) ⇒ `kh_version: null`, `projects: []`. */
export function evaluateKhCheck(p: KhProbe, checkedAt: string): KhCheckResult {
  const { acc } = walk(p);
  return {
    status: acc.items.some((i) => i.level === "error") ? "error" : "ok",
    checked_at: checkedAt,
    kh_version: acc.khVersion,
    embedder: acc.embedder,
    projects: acc.projects,
    items: acc.items,
  };
}
