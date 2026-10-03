// ADM-FR-54 · M4-R14 · M4-R15 · Q11 · `planImport` thuần (plan-cd §3.3, §6, §8.2): so file với snapshot → items, summary,
// missing_secrets, errors. Không I/O. Snapshot và file cùng qua `sortedEls` trước khi so (tránh cập nhật giả, C-E09).
// Tenant: chỉ sửa (không tạo); entitlement chỉ thêm; quota upsert theo (tenant, feature) → "after" = trạng thái hiệu lực.
import {
  type ConfigFile,
  type ImportItem,
  type ImportItemType,
  type ImportSummary,
  type MissingSecret,
  type QuotaEntry,
  type TenantEl,
  TRANSFER_TYPES,
  type TransferType,
} from "@ai/contracts";
import { runChecks } from "./transfer.checks";
import {
  type BaseView,
  type Diffed,
  type El,
  type Entry,
  Errs,
  type FileView,
  type ImportPlan,
  type Merged,
  tenantUsable,
} from "./transfer.import-ctx";
import { cmpStr, diffOp, type Snapshot, sortedEls, sortKeyOf } from "./transfer.norm";

export type { ImportPlan };

const ITEM_TYPE: Record<TransferType, ImportItemType> = {
  workflows: "workflow",
  commands: "command",
  features: "feature",
  tenants: "tenant",
  groups: "group",
  grants: "grant",
};
const KEY_FIELD: Record<TransferType, string> = {
  workflows: ".key",
  commands: ".name",
  features: ".key",
  tenants: ".key",
  groups: ".key",
  grants: "",
};

/** "300" / "300.5" → "300.00" / "300.50" (khớp `numeric(12,2)::text` của DB). */
const money = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const [a, b = ""] = v.split(".");
  return `${a}.${`${b}00`.slice(0, 2)}`;
};
export const normQuota = (q: QuotaEntry): QuotaEntry => ({
  feature: q.feature,
  max_runs: q.max_runs ?? null,
  max_tokens: q.max_tokens ?? null,
  max_usd: money(q.max_usd),
});
export const quotaScope = (q: { feature: string | null }): string => q.feature ?? "";

/** Hiệu lực sau import: entitlement hợp (chỉ thêm), quota upsert theo feature (dòng ngoài file giữ nguyên). */
export function mergeTenant(db: TenantEl, f: TenantEl): TenantEl {
  const quotas = new Map(db.quotas.map((q) => [quotaScope(q), normQuota(q)]));
  for (const q of f.quotas) quotas.set(quotaScope(q), normQuota(q));
  return {
    ...f,
    entitlements: [...new Set([...db.entitlements, ...f.entitlements])],
    quotas: [...quotas.values()],
  };
}

function baseView(s: Snapshot): BaseView {
  const v = { secrets: new Set(s.secrets) } as BaseView;
  const rec = v as unknown as Record<TransferType, Map<string, unknown>>;
  for (const t of TRANSFER_TYPES) {
    const els = sortedEls(t, (s[t] ?? []) as El<typeof t>[]).map((e) =>
      t === "tenants" ? { ...(e as TenantEl), quotas: (e as TenantEl).quotas.map(normQuota) } : e,
    );
    rec[t] = new Map(els.map((e) => [sortKeyOf(t, e as El<typeof t>), e]));
  }
  return v;
}

/** Phần tử đầu tiên của mỗi khoá; trùng → DUPLICATE_KEY tại `<type>[i].<khoá>`. */
function fileView(file: ConfigFile, err: Errs): FileView {
  const v = {} as Record<TransferType, Entry<TransferType>[]>;
  for (const t of TRANSFER_TYPES) {
    const seen = new Set<string>();
    v[t] = [];
    (file[t] ?? []).forEach((raw, i) => {
      const [e] = sortedEls(t, [raw as El<typeof t>]);
      const key = sortKeyOf(t, e as El<typeof t>);
      if (seen.has(key))
        err.add(`${t}[${i}]${KEY_FIELD[t]}`, "DUPLICATE_KEY", `Trùng khoá "${key}"`);
      else {
        seen.add(key);
        v[t].push({ i, e: e as El<TransferType>, raw: raw as El<TransferType>, key });
      }
    });
  }
  return v as unknown as FileView;
}

/** Phần tử "sau" (đã chuẩn hoá) của mỗi mục file; tenant không dùng được → không có. */
function afterOf<T extends TransferType>(t: T, x: Entry<T>, base: BaseView): El<T> | null {
  if (t === "tenants") {
    const db = base.tenants.get(x.key);
    if (!db || !tenantUsable(base, x.key)) return null;
    return sortedEls("tenants", [mergeTenant(db, x.e as TenantEl)])[0] as El<T>;
  }
  if (t === "groups" || t === "grants") {
    if (!tenantUsable(base, (x.e as { tenant: string }).tenant)) return null;
  }
  return x.e;
}

function diffAll(file: FileView, base: BaseView): Diffed {
  const out = {} as Record<TransferType, unknown[]>;
  for (const t of TRANSFER_TYPES) {
    out[t] = [];
    for (const x of file[t] as Entry<typeof t>[]) {
      const after = afterOf(t, x, base);
      if (after === null) continue;
      const before = (base[t] as Map<string, object>).get(x.key) ?? null;
      out[t].push({ ...x, after, op: diffOp(before, after as object) });
    }
  }
  return out as unknown as Diffed;
}

function mergedOf(base: BaseView, d: Diffed): Merged {
  const m = {} as Record<TransferType, Map<string, unknown>>;
  for (const t of TRANSFER_TYPES) {
    m[t] = new Map(base[t] as Map<string, unknown>);
    for (const x of d[t]) m[t].set(x.key, x.after);
  }
  return m as unknown as Merged;
}

function itemsOf(d: Diffed, base: BaseView): { items: ImportItem[]; summary: ImportSummary } {
  const items: ImportItem[] = [];
  const summary = { added: 0, updated: 0, unchanged: 0 };
  for (const t of TRANSFER_TYPES) {
    for (const x of d[t]) {
      if (x.op === "unchanged") {
        summary.unchanged++;
        continue;
      }
      if (x.op === "add") summary.added++;
      else summary.updated++;
      const before = (base[t] as Map<string, object>).get(x.key) ?? null;
      items.push({
        type: ITEM_TYPE[t],
        key: x.key,
        op: x.op,
        before: before as ImportItem["before"],
        after: x.after as ImportItem["after"],
      });
    }
  }
  return { items, summary };
}

/** Secret mà workflow trong file dùng mà DB chưa có; `used_by` sắp, danh sách sắp theo tên. */
function missingSecrets(d: Diffed, base: BaseView): MissingSecret[] {
  const by = new Map<string, string[]>();
  for (const x of d.workflows) {
    if (base.secrets.has(x.after.secret)) continue;
    by.set(x.after.secret, [...(by.get(x.after.secret) ?? []), x.key]);
  }
  return [...by.keys()]
    .sort(cmpStr)
    .map((name) => ({ name, used_by: [...(by.get(name) ?? [])].sort(cmpStr) }));
}

/** So file (đã qua `ConfigFileSchema`) với snapshot. Không xoá gì: thực thể ngoài file không có op. */
export function planImport(file: ConfigFile, s: Snapshot): ImportPlan {
  const err = new Errs();
  const fv = fileView(file, err);
  const base = baseView(s);
  const diffed = diffAll(fv, base);
  const m = mergedOf(base, diffed);
  runChecks({ file: fv, base, diffed, m, err });
  return {
    ...itemsOf(diffed, base),
    missing_secrets: missingSecrets(diffed, base),
    errors: err.finish(),
  };
}
