// ADM-FR-42, ADM-BR-09 · M4-R01, R07, R08 · hàm thuần báo cáo usage (plan-rules §A5). Không biết DB/HTTP.
import { type Role, USAGE_MAX_DAYS } from "@ai/contracts";
import { QUOTA_TZ_OFFSET_MIN } from "../quotas/quotas.rules";

const DAY_MS = 86_400_000;
const TZ_MS = QUOTA_TZ_OFFSET_MIN * 60_000;

/** tenant_admin: vắng/own → tenant mình, khác → not_found. platform: vắng → null (mọi tenant). */
export function resolveUsageTenant(
  actor: { role: Role; tenantId: string },
  tenantParam: string | undefined,
): { tenantId: string | null } | "not_found" {
  if (actor.role === "platform_admin") return { tenantId: tenantParam ?? null };
  if (tenantParam === undefined || tenantParam === actor.tenantId)
    return { tenantId: actor.tenantId };
  return "not_found";
}

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** 00:00 VN của ngày `YYYY-MM-DD`, ra UTC ms. */
const vnStartMs = (d: string) => Date.parse(`${d}T00:00:00Z`) - TZ_MS;

/** Ngày đầu / cuối tháng VN hiện tại. */
function currentMonthDays(now: Date): { first: string; last: string } {
  const vn = new Date(now.getTime() + TZ_MS);
  const y = vn.getUTCFullYear();
  const m = vn.getUTCMonth();
  return { first: dayStr(Date.UTC(y, m, 1)), last: dayStr(Date.UTC(y, m + 1, 1) - DAY_MS) };
}

const VALID_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (d: string) =>
  VALID_DAY.test(d) &&
  !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
  dayStr(Date.parse(`${d}T00:00:00Z`)) === d;

/**
 * Khoảng nửa mở [from 00:00 VN, to+1 00:00 VN) ra UTC; mỗi biên vắng lấy theo tháng VN hiện tại. `prev` = khoảng
 * liền trước cùng số ngày. from > to, ngày hỏng hoặc > 366 ngày → "invalid".
 */
export function usageRange(
  q: { from?: string; to?: string },
  now: Date,
): { from: Date; to: Date; prevFrom: Date; prevTo: Date; days: string[] } | "invalid" {
  const month = currentMonthDays(now);
  const f = q.from ?? month.first;
  const t = q.to ?? month.last;
  if (!isDay(f) || !isDay(t) || f > t) return "invalid";
  const fromMs = vnStartMs(f);
  const toMs = vnStartMs(t) + DAY_MS;
  const n = Math.round((toMs - fromMs) / DAY_MS);
  if (n > USAGE_MAX_DAYS) return "invalid";
  const base = Date.parse(`${f}T00:00:00Z`);
  const days = Array.from({ length: n }, (_, i) => dayStr(base + i * DAY_MS));
  return {
    from: new Date(fromMs),
    to: new Date(toMs),
    prevFrom: new Date(fromMs - n * DAY_MS),
    prevTo: new Date(fromMs),
    days,
  };
}

const CSV_BASE = [
  "date",
  "tenant_key",
  "feature_key",
  "runs",
  "input_tokens",
  "output_tokens",
  "billable_usd",
] as const;

/** Cột CSV theo role: platform chèn `cost_usd` ngay sau `billable_usd` (M4-R08). */
export function csvColumns(role: Role): readonly string[] {
  return role === "platform_admin"
    ? [...CSV_BASE, "cost_usd", "overage_runs"]
    : [...CSV_BASE, "overage_runs"];
}

const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTE = /[",\r\n]/;

/** Một ô: null → rỗng; chuỗi bắt đầu = + - @ TAB CR → tiền tố `'`; có , " CR LF → bao nháy, nháy nhân đôi. */
function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return NEEDS_QUOTE.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** CSV UTF-8 có BOM, dòng ngăn CRLF (kể cả sau dòng cuối), tiêu đề = `columns`. */
export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, string | number | null>[],
): string {
  const lines = [columns.map(csvCell).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

const COST_KEYS = new Set(["cost_usd", "margin_usd", "tenants"]);

function strip(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(strip);
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) if (!COST_KEYS.has(k)) out[k] = strip(x);
  return out;
}

/** Role ≠ platform_admin → xoá đệ quy `cost_usd`, `margin_usd`, `tenants` (M4-R08, M4-AC03). */
export function stripCost<T extends Record<string, unknown>>(role: Role, v: T): T {
  return role === "platform_admin" ? v : (strip(v) as T);
}
