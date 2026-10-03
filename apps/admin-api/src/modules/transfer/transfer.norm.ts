// ADM-FR-54 · M4-R14 · chuẩn hoá phần tử file cấu hình (thuần, không I/O): khoá sắp, tập sắp, so sau chuẩn hoá.
// Dùng chung cho export (`buildExportFile`) và import (`planImport`) — tách riêng để không vòng import rules ↔ plan.
import type {
  ConfigFileBody,
  FeatureEl,
  GrantEl,
  GroupEl,
  QuotaEntry,
  TenantEl,
  TransferType,
} from "@ai/contracts";

type SecretName = string;
/** Snapshot DB ở dạng phần tử file; `secrets` = mọi tên secret đang có (không giá trị). */
export type Snapshot = { configVersion: number; secrets: SecretName[] } & Partial<ConfigFileBody>;
export type El<T extends TransferType> = NonNullable<ConfigFileBody[T]>[number];

/** So chuỗi theo code unit (khớp `Array#sort()` mặc định; không theo collation DB). */
export const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Khoá sắp/hiển thị: command = `name`, group = `tenant/key`, grant = `tenant/group/feature`, còn lại = `key`. */
export function sortKeyOf<T extends TransferType>(t: T, e: El<T>): string {
  switch (t) {
    case "commands":
      return (e as El<"commands">).name;
    case "groups": {
      const g = e as GroupEl;
      return `${g.tenant}/${g.key}`;
    }
    case "grants": {
      const g = e as GrantEl;
      return `${g.tenant}/${g.group}/${g.feature}`;
    }
    default:
      return (e as { key: string }).key;
  }
}

const sortBy = <T>(xs: readonly T[], key: (x: T) => string): T[] =>
  [...xs].sort((a, b) => cmpStr(key(a), key(b)));
export const sortStrs = (xs: readonly string[]): string[] => [...xs].sort(cmpStr);

/** Quota: `feature` null (cả tenant) đầu, rồi theo key. */
const quotaKey = (q: QuotaEntry): string => (q.feature === null ? "" : `~${q.feature}`);

/** Chuẩn hoá phần tử để file ổn định: các tập (commands, entitlements, quotas) sắp theo key. */
function normalizeEl<T extends TransferType>(t: T, e: El<T>): El<T> {
  if (t === "features") {
    const f = e as FeatureEl;
    return { ...f, commands: sortStrs(f.commands) } as El<T>;
  }
  if (t === "tenants") {
    const x = e as TenantEl;
    return {
      ...x,
      entitlements: sortStrs(x.entitlements),
      quotas: sortBy(x.quotas, quotaKey),
    } as El<T>;
  }
  return e;
}

/** Danh sách của loại `t` đã chuẩn hoá và sắp theo `sortKeyOf`. */
export function sortedEls<T extends TransferType>(t: T, xs: readonly El<T>[]): El<T>[] {
  return sortBy(
    xs.map((e) => normalizeEl(t, e)),
    (e) => sortKeyOf(t, e),
  );
}

/** JSON với khoá object sắp (đệ quy); thứ tự mảng giữ nguyên. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => cmpStr(a, b));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** So sau chuẩn hoá thứ tự khoá (người gọi tự chuẩn hoá các tập, vd `sortedEls`). */
export function diffOp(before: object | null, after: object): "add" | "update" | "unchanged" {
  if (before === null) return "add";
  return canonicalJson(before) === canonicalJson(after) ? "unchanged" : "update";
}
