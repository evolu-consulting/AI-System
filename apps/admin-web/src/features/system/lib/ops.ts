// CR-104 · ops-ui · hàm thuần của trang `/system`: trạng thái tổng, hạn kiểm kế, kiểm cấu hình (phản chiếu contract
// `OpsSettingsSchema`), gói chẩn đoán. Không React, không mạng.
import {
  OPS_CHECK_KEYS,
  OPS_CHECK_META,
  OPS_EVERY_MIN,
  type OpsCheckKey,
  type OpsCheckRow,
  type OpsEvent,
  type OpsSettings,
  type OpsStatus,
} from "@ai/contracts/hub-admin";

const RANK: Record<OpsStatus, number> = { ok: 0, unknown: 1, warn: 2, crit: 3 };

export const isCheckKey = (k: string): k is OpsCheckKey =>
  (OPS_CHECK_KEYS as readonly string[]).includes(k);

/** Trạng thái xấu nhất trong các check ĐANG BẬT; thiếu dòng của check đang bật hoặc chưa có dòng nào ⇒ ít nhất `unknown`. */
export function overallStatus(rows: readonly OpsCheckRow[], settings: OpsSettings): OpsStatus {
  const have = new Set(rows.map((r) => r.check_key));
  // check đang bật mà chưa có dòng ⇒ chưa rõ (không báo "ổn" khi chưa kiểm hết)
  let worst: OpsStatus = OPS_CHECK_KEYS.some((k) => settings.checks[k].enabled && !have.has(k))
    ? "unknown"
    : "ok";
  let any = false;
  for (const r of rows) {
    if (isCheckKey(r.check_key) && !settings.checks[r.check_key].enabled) continue;
    any = true;
    if (RANK[r.status] > RANK[worst]) worst = r.status;
  }
  return any ? worst : "unknown";
}

/** Lượt kiểm kế tiếp = lượt cuối + tần suất (phút). Chưa có lượt nào ⇒ null. */
export function nextDueAt(lastRoundAt: string | null, everyMin: number): Date | null {
  if (!lastRoundAt) return null;
  const t = Date.parse(lastRoundAt);
  return Number.isNaN(t) ? null : new Date(t + everyMin * 60_000);
}

/** Lệnh trong gợi ý sửa: ưu tiên đoạn trong dấu huyền (`…`), rồi dòng bắt đầu bằng `$ `. Không có ⇒ null (không hiện nút chép). */
export function extractCommand(hint: string | null): string | null {
  if (!hint) return null;
  const tick = /`([^`\n]+)`/.exec(hint);
  if (tick?.[1]) return tick[1].trim();
  const line = hint.split("\n").find((l) => l.trimStart().startsWith("$ "));
  return line ? line.trimStart().slice(2).trim() : null;
}

/** Giá trị hiển thị gọn của `value` (kiểu tự do theo từng check). */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

// ── Kiểm cấu hình (client, phản chiếu contract) ──────────────────────────────────────────────────

export type FieldError =
  | { code: "required" }
  | { code: "int" }
  | { code: "range"; min: number; max: number }
  | { code: "order"; order: "asc" | "desc" }
  | { code: "server"; message: string };
/** Khoá lỗi: `every_min` | `<check>.warn` | `<check>.crit`. */
export type SettingsErrors = Record<string, FieldError>;

/** Bản nháp một ô: số, `null` = để trống, `NaN` = gõ không phải số nguyên. */
export type Draft = number | null;

function levelError(v: Draft | undefined, r: { min: number; max: number }): FieldError | null {
  if (v === null || v === undefined) return { code: "required" };
  if (!Number.isInteger(v)) return { code: "int" };
  if (v < r.min || v > r.max) return { code: "range", min: r.min, max: r.max };
  return null;
}

function checkErrors(key: OpsCheckKey, c: OpsSettings["checks"][OpsCheckKey]): SettingsErrors {
  const out: SettingsErrors = {};
  const m = OPS_CHECK_META[key];
  for (const lv of ["warn", "crit"] as const) {
    const range = m[lv];
    const le = range ? levelError(c[lv], range) : null;
    if (le) out[`${key}.${lv}`] = le;
  }
  const { warn, crit } = c;
  const comparable = m.order && warn !== null && crit !== null && Object.keys(out).length === 0;
  if (comparable && m.order && (m.order === "asc" ? warn >= crit : warn <= crit))
    out[`${key}.crit`] = { code: "order", order: m.order };
  return out;
}

/** Cùng luật với `OpsSettingsSchema`: tần suất 5–1440, ngưỡng nguyên trong khoảng meta, warn<crit (asc) hoặc warn>crit (desc). */
export function validateSettings(s: OpsSettings): SettingsErrors {
  const out: SettingsErrors = {};
  const e = levelError(s.every_min, OPS_EVERY_MIN);
  if (e) out.every_min = e;
  for (const key of OPS_CHECK_KEYS) Object.assign(out, checkErrors(key, s.checks[key]));
  return out;
}

const fieldKey = (path: string[]): string | null => {
  if (path[0] === "every_min") return "every_min";
  if (path[0] !== "checks" || !path[1]) return null;
  return `${path[1]}.${path[2] === "warn" ? "warn" : "crit"}`;
};

/** 422 `OPS_SETTINGS_INVALID` → lỗi theo ô (`details.issues[].path` = ["checks", "disk", "crit"] | ["every_min"]). */
export function serverErrors(details: unknown): SettingsErrors {
  const out: SettingsErrors = {};
  const issues = (details as { issues?: unknown } | null | undefined)?.issues;
  if (!Array.isArray(issues)) return out;
  for (const raw of issues) {
    const i = raw as { path?: unknown; message?: unknown };
    const key = fieldKey(Array.isArray(i.path) ? i.path.map(String) : []);
    if (key && !out[key]) out[key] = { code: "server", message: String(i.message ?? "") };
  }
  return out;
}

export const sameSettings = (a: OpsSettings, b: OpsSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

// ── Gói chẩn đoán ────────────────────────────────────────────────────────────────────────────────

export const DIAG_EVENTS = 20;

/** Tham chiếu bản deploy nếu check nào đó (vd đĩa — file host) ghi kèm trong `value`. */
export function deployRef(rows: readonly OpsCheckRow[]): string | null {
  for (const r of rows) {
    const v = r.value;
    if (!v || typeof v !== "object") continue;
    for (const k of ["deploy_ref", "deploy", "version", "commit"]) {
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === "string" && x) return x;
    }
  }
  return null;
}

export type DiagnosticInput = {
  now: Date;
  /** Môi trường (vd origin trang). Rỗng ⇒ bỏ dòng. */
  env?: string;
  rows: readonly OpsCheckRow[];
  events: readonly OpsEvent[];
  settings: OpsSettings;
  labelOf: (key: string) => string;
  /** Tên người đổi cấu hình theo id (không biết ⇒ trả id rút gọn). */
  actorOf: (id: string | null) => string;
  /** Nhãn cố định của gói (đoạn dán cho Claude Code). */
  text: {
    title: string;
    time: string;
    env: string;
    deploy: string;
    checks: string;
    disabled: string;
    events: string;
    noEvents: string;
    settingsChanged: (actor: string) => string;
  };
};

const iso = (d: Date | string): string => (d instanceof Date ? d.toISOString() : d);

function checkLines(i: DiagnosticInput, key: string, r: OpsCheckRow | undefined): string[] {
  const label = i.labelOf(key);
  if (isCheckKey(key) && !i.settings.checks[key].enabled) return [`- ${label}: ${i.text.disabled}`];
  if (!r) return [];
  const val = formatValue(r.value);
  const head = `- ${label}: ${r.status.toUpperCase()} — ${r.message}${val ? ` [${val}]` : ""} (${iso(r.checked_at)})`;
  return r.hint && r.status !== "ok" ? [head, `    > ${r.hint}`] : [head];
}

function eventLine(i: DiagnosticInput, e: OpsEvent): string {
  const what =
    e.kind === "settings_changed"
      ? i.text.settingsChanged(i.actorOf(e.actor_user_id))
      : `${e.check_key ? i.labelOf(e.check_key) : "?"}: ${e.from_status ?? "—"} → ${e.to_status ?? "—"}`;
  return `- ${iso(e.at)} ${what}`;
}

/** Văn bản thuần: giờ, môi trường/bản deploy (nếu có), mọi check (trạng thái · thông điệp · giá trị), 20 sự kiện gần nhất. */
export function buildDiagnosticText(i: DiagnosticInput): string {
  const t = i.text;
  const dep = deployRef(i.rows);
  const lines: string[] = [t.title, `${t.time}: ${iso(i.now)}`];
  if (i.env) lines.push(`${t.env}: ${i.env}`);
  if (dep) lines.push(`${t.deploy}: ${dep}`);
  lines.push("", `${t.checks}:`);
  const byKey = new Map(i.rows.map((r) => [r.check_key, r]));
  const extra = i.rows.map((r) => r.check_key).filter((k) => !isCheckKey(k));
  for (const key of [...OPS_CHECK_KEYS, ...extra])
    lines.push(...checkLines(i, key, byKey.get(key)));
  lines.push("", `${t.events}:`);
  const evs = i.events.slice(0, DIAG_EVENTS);
  if (evs.length === 0) lines.push(`- ${t.noEvents}`);
  for (const e of evs) lines.push(eventLine(i, e));
  return `${lines.join("\n")}\n`;
}
