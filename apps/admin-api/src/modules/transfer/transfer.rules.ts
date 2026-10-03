// ADM-FR-54 · ADM-BR-04 · M4-R14 · M4-R15 · AC-A06 · luật thuần Import/Export (plan-cd §6). Không I/O.
// Export: dựng file từ snapshot (dạng phần tử file), sắp theo key, secret chỉ tên. `planImport` ở T8.
import {
  CONFIG_FILE_FORMAT,
  CONFIG_FORMAT_VERSION,
  type ConfigFile,
  type ConfigFileBody,
  type FeatureEl,
  type GrantEl,
  type GroupEl,
  type QuotaEntry,
  type TenantEl,
  TRANSFER_TYPES,
  type TransferType,
  type WorkflowEl,
} from "@ai/contracts";

export type { TransferType };

type SecretName = string;
/** Snapshot DB ở dạng phần tử file; `secrets` = mọi tên secret đang có (không giá trị). */
export type Snapshot = { configVersion: number; secrets: SecretName[] } & Partial<ConfigFileBody>;
type El<T extends TransferType> = NonNullable<ConfigFileBody[T]>[number];

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
const sortStrs = (xs: readonly string[]): string[] => [...xs].sort(cmpStr);

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

/** Tên secret mà các workflow tham chiếu (duy nhất, sắp) — không bao giờ có giá trị/last4 (BR-04). */
export function referencedSecrets(workflows: readonly WorkflowEl[]): { name: SecretName }[] {
  return sortStrs([...new Set(workflows.map((w) => w.secret))]).map((name) => ({ name }));
}

/** File export: đầu file + đúng các loại trong `types`; `secrets` chỉ từ workflow được export. */
export function buildExportFile(
  s: Snapshot,
  types: readonly TransferType[],
  now: Date,
): ConfigFile {
  const file: ConfigFile = {
    format: CONFIG_FILE_FORMAT,
    format_version: CONFIG_FORMAT_VERSION,
    config_version: s.configVersion,
    exported_at: now.toISOString(),
    secrets: [],
  };
  const body = file as Record<string, unknown>;
  for (const t of TRANSFER_TYPES) {
    if (types.includes(t)) body[t] = sortedEls(t, s[t] ?? []);
  }
  file.secrets = referencedSecrets(file.workflows ?? []);
  return file;
}

export function exportFileName(configVersion: number): string {
  return `config-v${configVersion}.yaml`;
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

/** `missing` = tên cần mà chưa có giá trị; `extra` = tên gửi lên không thuộc tập cần (M4-R15). Giữ thứ tự đầu vào. */
export function checkSecretsInput(
  missing: readonly string[],
  given: Record<string, string>,
): { missing: string[]; extra: string[] } {
  const need = new Set(missing);
  return {
    missing: missing.filter((n) => !Object.hasOwn(given, n)),
    extra: Object.keys(given).filter((n) => !need.has(n)),
  };
}
