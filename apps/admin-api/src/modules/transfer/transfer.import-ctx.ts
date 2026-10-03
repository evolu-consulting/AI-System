// ADM-FR-54 · kiểu dùng chung của `planImport` (transfer.plan) và kiểm luật (transfer.checks): góc nhìn file/snapshot,
// trạng thái sau import, bộ gom lỗi. Thuần, không I/O.
import {
  type ConfigFileBody,
  IMPORT_ERRORS_MAX,
  type ImportError,
  type ImportItem,
  type ImportSummary,
  type MissingSecret,
  type TransferType,
} from "@ai/contracts";
import { PLATFORM_TENANT_KEY } from "../tenants/tenants.rules";

export type El<T extends TransferType> = NonNullable<ConfigFileBody[T]>[number];
/** `e` = phần tử đã chuẩn hoá (tập sắp); `raw` = đúng như file (chỉ số trong đường dẫn lỗi theo `raw`). */
export type Entry<T extends TransferType> = { i: number; e: El<T>; raw: El<T>; key: string };
export type FileView = { [K in TransferType]: Entry<K>[] };
export type BaseView = { [K in TransferType]: Map<string, El<K>> } & { secrets: Set<string> };
export type Op = "add" | "update" | "unchanged";
/** Trạng thái sau import (snapshot ⊕ file) — dùng cho kiểm tham chiếu/luật. */
export type Merged = { [K in TransferType]: Map<string, El<K>> };
export type ImportPlan = {
  items: ImportItem[];
  summary: ImportSummary;
  missing_secrets: MissingSecret[];
  errors: ImportError[];
};

export type Diffed = { [K in TransferType]: (Entry<K> & { after: El<K>; op: Op })[] };

export type PlanCtx = { file: FileView; base: BaseView; diffed: Diffed; m: Merged; err: Errs };

/** Gom lỗi; quá `IMPORT_ERRORS_MAX` → giữ 99 lỗi đầu + 1 `TOO_MANY_ERRORS`. */
export class Errs {
  readonly list: ImportError[] = [];
  add(path: string, code: ImportError["code"], message: string, params?: Record<string, string>) {
    this.list.push(params ? { path, code, message, params } : { path, code, message });
  }
  rule(path: string, code: string, message: string, extra: Record<string, string> = {}) {
    this.add(path, "RULE", message, { code, ...extra });
  }
  finish(): ImportError[] {
    if (this.list.length <= IMPORT_ERRORS_MAX) return this.list;
    const total = String(this.list.length);
    return [
      ...this.list.slice(0, IMPORT_ERRORS_MAX - 1),
      { path: "", code: "TOO_MANY_ERRORS", message: `Quá nhiều lỗi (${total})`, params: { total } },
    ];
  }
}

/** `["commands", 2, "workflow"]` → `commands[2].workflow`. */
export function formatPath(parts: readonly PropertyKey[]): string {
  let out = "";
  for (const p of parts)
    out += typeof p === "number" ? `[${p}]` : out ? `.${String(p)}` : String(p);
  return out;
}

/** Tenant phải có sẵn và không phải `platform` (Q11); không hợp lệ → bỏ khỏi items/merge (lỗi do checks báo). */
export const tenantUsable = (base: BaseView, key: string): boolean =>
  key !== PLATFORM_TENANT_KEY && base.tenants.has(key);
