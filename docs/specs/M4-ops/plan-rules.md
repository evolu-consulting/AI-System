# Plan · M4-ops — phụ lục chữ ký hàm thuần (khối A + B)

Chữ ký chốt để qc viết test trước; ngữ cảnh ở [plan.md](plan.md). Mỗi hàm thuần, không I/O; đổi chữ ký = đổi contract (backend-lead).

## A1 · `lib/audit/audit.rules.ts` (snapshot)
```ts
export const AUDIT_FIELDS: Readonly<Record<AuditEntity, readonly string[]>>;   // allowlist bảng dưới
export const FORBIDDEN_AUDIT_KEYS: readonly string[]; // password, password_hash, totp_secret, ciphertext, iv, token_hash, value, backup_codes, code_hash
export const USER_DEFINED_AUDIT_FIELDS: readonly string[]; // input_map, input_schema, args, output — nội dung người dùng định nghĩa
export function auditSnapshot(entity: AuditEntity, dto: Readonly<Record<string, unknown>>): Record<string, unknown>;
// pick allowlist; ném nếu khoá cấp 1 của kết quả ∈ FORBIDDEN_AUDIT_KEYS; KHÔNG duyệt sâu vào USER_DEFINED_AUDIT_FIELDS
// (vd `workflow.input_schema` có thuộc tính `password` là hợp lệ → không ném)
export function containsForbiddenKey(v: unknown): boolean; // tiện ích đệ quy mọi độ sâu (test/kiểm DTO), auditSnapshot không dùng cho phần người dùng định nghĩa
```

## A2 · `modules/audit/audit.rules.ts` (đọc, khôi phục)
```ts
export type AuditFilter = { kind: "tenant"; tenantId: string } | { kind: "system" } | { kind: "all" };
export function resolveAuditFilter(actor: { role: Role; tenantId: string }, tenantParam: string | undefined): AuditFilter | "not_found";
// tenant_admin: undefined | own → tenant(own); khác/"system" → not_found. platform: undefined → all; "system" → system; uuid → tenant
export function canRestore(role: Role, e: { entity: AuditEntity; action: AuditAction; snapshot: boolean }): boolean;
// role = platform_admin ∧ entity ∈ {command, workflow, feature, group, quota} ∧ action ∈ {update, delete, restore} ∧ snapshot
export function encodeCursor(seq: string): string;
export function decodeCursor(s: string): string | null; // không hợp lệ → null → 400 VALIDATION_ERROR
```

## A3 · `modules/audit/audit.rules.ts` (`restoreCheck`)
```ts
export function restoreCheck(e: { action: AuditAction; entityVersion: number | null },
  cur: { exists: boolean; version: number | null }): "ok" | "NOT_RESTORABLE" | "VERSION_CONFLICT";
```

## A4 · `modules/quotas/quotas.rules.ts`
```ts
export const QUOTA_TZ_OFFSET_MIN = 420;              // Asia/Ho_Chi_Minh, không DST (M4-R01)
export type Level = "none" | "warn" | "over";
export type QuotaLimitsN = { maxRuns: number | null; maxTokens: number | null; maxUsd: string | null };
export type UsageN = { runs: number; tokens: number; billableUsd: string; unpricedRows: number };
export type QuotaRow = QuotaLimitsN & { featureId: string | null };
export type QuotaEval = { featureId: string | null; pct: number | null; level: Level; used: UsageN };
export function monthRange(now: Date): { month: string; from: Date; to: Date };   // [01 00:00 VN, 01 tháng sau) ra UTC
export function quotaPct(l: QuotaLimitsN, u: UsageN): number | null;   // max các chiều có giới hạn, floor(used*100/max); không chiều nào → null
export function quotaLevel(pct: number | null): Level;                 // null/<80 none · 80–99 warn · ≥100 over
export function evaluateQuota(i: { quotas: readonly QuotaRow[]; total: UsageN;
  byFeature: ReadonlyMap<string, UsageN> }): QuotaEval[];               // feature quota dùng byFeature (thiếu = 0), null dùng total
export type AlertKey = { featureId: string | null; level: 80 | 100 };
export function alertsDue(evals: readonly QuotaEval[], existing: readonly AlertKey[]):
  (AlertKey & { pct: number; status: "pending" | "skipped" })[];
// warn → 80 pending; over → 100 pending + 80 "skipped" nếu chưa có (không gửi 80 sau 100); đã có trong existing → bỏ
export function bannerFor(role: Role, evals: readonly QuotaEval[]): { level: "warn" | "over"; pct: number; featureId: string | null } | null;
// role ≠ tenant_admin → null; lấy eval có pct lớn nhất với level ≠ none; bằng nhau → featureId null trước
export function normalizeQuotaItems(items: readonly QuotaItemInput[]): QuotaItemInput[];        // bỏ dòng mọi giới hạn null
export function duplicateFeatureIndex(items: readonly QuotaItemInput[]): number | null;         // null coi là một giá trị
export function alertMail(i: { tenantName: string; pct: number; locale: "vi" | "en"; link: string }): { subject: string; text: string };
// vi: "[{tenant}] Đã dùng {pct}% quota tháng"; en: "[{tenant}] {pct}% of monthly quota used"
```

## A5 · `modules/usage/usage.rules.ts`
```ts
export function resolveUsageTenant(actor: { role: Role; tenantId: string }, tenantParam: string | undefined): { tenantId: string | null } | "not_found";
export function usageRange(q: { from?: string; to?: string }, now: Date): { from: Date; to: Date; prevFrom: Date; prevTo: Date; days: string[] } | "invalid";
export function csvColumns(role: Role): readonly string[];
export function toCsv(columns: readonly string[], rows: readonly Record<string, string | number | null>[]): string; // BOM, CRLF, quote, chống formula
export function stripCost<T extends Record<string, unknown>>(role: Role, v: T): T;  // xoá đệ quy cost_usd, margin_usd, tenants khi role ≠ platform_admin
```
